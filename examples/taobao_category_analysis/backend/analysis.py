from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from re import findall, search, split, sub
from statistics import median
from typing import Any

from .llm import generate_ai_summary
from .logging_utils import log_event


_COMMON_TITLE_TERMS = {
    "淘宝",
    "天猫",
    "官方",
    "旗舰",
    "旗舰店",
    "正品",
    "包邮",
    "现货",
    "新品",
    "新款",
    "热卖",
}


@dataclass(frozen=True)
class NormalizedItem:
    title: str
    price_text: str
    price_value: float | None
    sales_text: str
    sales_value: int | None
    shop_name: str
    item_url: str
    image_url: str
    rank: int


def analyze_category(payload: dict[str, Any], request_id: str = "", analysis_id: str = "") -> dict[str, Any]:
    raw_items_count = len(payload.get("items") or [])
    log_event(
        "analysis.normalize_started",
        request_id=request_id,
        analysis_id=analysis_id,
        raw_items_count=raw_items_count,
    )
    items = _dedupe_items(payload.get("items") or [])
    log_event(
        "analysis.dedupe_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        raw_items_count=raw_items_count,
        deduped_items_count=len(items),
        duplicates_removed=raw_items_count - len(items),
    )
    normalized_items = [_normalize_item(item, index + 1) for index, item in enumerate(items)]
    log_event(
        "analysis.normalize_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        normalized_items_count=len(normalized_items),
    )

    log_event("analysis.metrics_started", request_id=request_id, analysis_id=analysis_id)
    metrics = {
        "price": _price_metrics(normalized_items),
        "sales": _sales_metrics(normalized_items),
        "shops": _shop_metrics(normalized_items),
        "title_terms": _title_term_metrics(normalized_items),
        "data_quality": _data_quality_metrics(normalized_items),
    }
    log_event(
        "analysis.metrics_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        price_parsed_count=metrics["price"]["count"],
        sales_parsed_count=metrics["sales"]["parsed_count"],
        unique_shop_count=metrics["shops"]["unique_shop_count"],
        title_terms_count=len(metrics["title_terms"]),
        data_quality=metrics["data_quality"],
    )
    log_event("analysis.local_report_started", request_id=request_id, analysis_id=analysis_id)
    local_report = build_report(payload.get("keyword") or "", metrics, len(normalized_items))
    local_summary = build_summary(payload.get("keyword") or "", metrics, len(normalized_items))
    log_event(
        "analysis.local_report_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        report_sections=list(local_report.keys()),
        summary_sections=list(local_summary.keys()),
    )
    summary, report, summary_source = generate_ai_summary(
        keyword=payload.get("keyword") or "",
        metrics=metrics,
        sample_items=[_item_for_prompt(item) for item in normalized_items[:12]],
        fallback_summary=local_summary,
        fallback_report=local_report,
        request_id=request_id,
        analysis_id=analysis_id,
    )
    metrics["summary_source"] = summary_source
    log_event(
        "analysis.summary_selected",
        request_id=request_id,
        analysis_id=analysis_id,
        summary_source=summary_source,
        report_sections=list(report.keys()),
    )

    return {
        "raw_items_count": raw_items_count,
        "items_count": len(normalized_items),
        "metrics": metrics,
        "summary": summary,
        "report": report,
    }


def build_summary(keyword: str, metrics: dict[str, Any], items_count: int) -> dict[str, str]:
    price = metrics["price"]
    sales = metrics["sales"]
    shops = metrics["shops"]
    terms = metrics["title_terms"][:8]

    keyword_label = f"“{keyword}”" if keyword else "当前类目"
    median_price = price.get("median")
    top_band = _top_bucket(price.get("bands") or [])
    top_terms = "、".join(term["term"] for term in terms[:5]) or "暂无明显高频词"
    top_shop_ratio = shops.get("top5_concentration_ratio") or 0
    sales_parsed = sales.get("parsed_count") or 0

    if median_price is None:
        price_sentence = "当前页价格字段不足，暂时无法判断主流价格带。"
    elif top_band:
        price_sentence = f"当前页价格中位数约为 {median_price} 元，商品主要集中在 {top_band}。"
    else:
        price_sentence = f"当前页价格中位数约为 {median_price} 元。"

    if top_shop_ratio >= 0.5:
        competition = "当前页头部店铺重复度偏高，类目可能存在较强头部集中。"
    elif top_shop_ratio >= 0.25:
        competition = "当前页店铺分布较分散但已有一定头部集中，适合继续观察头部商品卖点。"
    else:
        competition = "当前页店铺分布较分散，第一页样本暂未显示明显垄断。"

    if sales_parsed:
        sales_sentence = f"有 {sales_parsed} 个商品可解析销量文本，中位销量约为 {sales.get('median')}。"
    else:
        sales_sentence = "销量字段多为文本或缺失，建议仅作为热度参考，不直接当作精确销量。"

    return {
        "market_overview": f"{keyword_label}当前页共分析 {items_count} 个商品。{price_sentence}{sales_sentence}",
        "competition": competition,
        "price_opportunity": _price_opportunity(price),
        "title_suggestions": f"当前页高频标题词包括：{top_terms}。标题优化可优先围绕这些可见卖点做差异化组合。",
        "risk_notes": "本结果只基于用户当前浏览器第一页可见数据，不代表全站完整类目；淘宝页面结构、个性化推荐和登录状态都会影响样本。",
    }


def build_report(keyword: str, metrics: dict[str, Any], items_count: int) -> dict[str, Any]:
    price = metrics["price"]
    sales = metrics["sales"]
    shops = metrics["shops"]
    terms = metrics["title_terms"]
    quality = metrics["data_quality"]

    keyword_label = f"“{keyword}”" if keyword else "当前类目"
    total = quality.get("total") or items_count
    price_count = price.get("count") or 0
    sales_count = sales.get("parsed_count") or 0
    shop_count = shops.get("unique_shop_count") or 0
    top_band = _top_bucket(price.get("bands") or [])
    top_terms = [term["term"] for term in terms[:8]]
    top_shops = [shop["term"] for shop in shops.get("top_shops", [])[:5]]

    return {
        "market_snapshot": {
            "title": "市场样本概况",
            "conclusion": (
                f"{keyword_label}当前页共识别 {items_count} 个有效商品，适合判断第一页供给密度和可见热度，"
                "不能外推为全站市场规模。"
            ),
            "evidence": [
                f"有效价格数：{price_count}，价格字段完整度：{_ratio_label(price_count, total)}。",
                f"可解析销量数：{sales_count}，销量字段完整度：{_ratio_label(sales_count, total)}。",
                f"店铺去重数：{shop_count}，店铺字段缺失数：{quality.get('missing_shop_name', 0)}。",
            ],
            "suggestion": "把本报告作为搜索第一页样本诊断；如需判断规模、增速或季节性，需要补充多页、多时段或平台级数据。",
        },
        "price_structure": {
            "title": "价格结构",
            "conclusion": _price_structure_conclusion(price),
            "evidence": [
                f"价格范围：{_value_or_empty(price.get('min'))}-{_value_or_empty(price.get('max'))} 元。",
                f"价格中位数：{_value_or_empty(price.get('median'))} 元。",
                f"主流价格带：{top_band or '暂无'}。",
            ],
            "suggestion": _price_opportunity(price),
        },
        "competition_landscape": {
            "title": "竞争格局",
            "conclusion": _competition_conclusion(shops),
            "evidence": [
                f"店铺去重数：{shop_count}。",
                f"重复出现店铺数：{shops.get('duplicate_shop_count', 0)}。",
                f"Top5 店铺集中度：{_ratio_label(shops.get('top5_concentration_ratio', 0), 1)}。",
                f"头部店铺：{'、'.join(top_shops) if top_shops else '暂无'}。",
            ],
            "suggestion": "优先跟踪重复出现和排名靠前的店铺，拆解它们的标题卖点、价格带和销量文本，而不是只看单个商品。",
        },
        "demand_signals": {
            "title": "用户需求信号",
            "conclusion": _demand_conclusion(top_terms),
            "evidence": [
                f"高频标题词：{'、'.join(top_terms[:8]) if top_terms else '暂无'}。",
                "这些词来自商品标题，只能代表商家正在强调的卖点和场景，不等同于真实用户画像。",
            ],
            "suggestion": "选品和标题优化可围绕高频词做组合，但需要保留差异化表达，避免与第一页商品完全同质化。",
        },
        "sales_heat": {
            "title": "销量热度",
            "conclusion": _sales_conclusion(sales),
            "evidence": [
                f"可解析销量数：{sales_count}。",
                f"销量范围：{_value_or_empty(sales.get('min'))}-{_value_or_empty(sales.get('max'))}。",
                f"销量中位数：{_value_or_empty(sales.get('median'))}。",
            ],
            "suggestion": "销量文本可用于判断相对热度，但淘宝文案口径可能变化，不建议当作精确订单量。",
        },
        "opportunities_and_risks": {
            "title": "机会点与风险点",
            "opportunities": _opportunities(price, shops, top_terms),
            "risks": _risks(metrics),
        },
        "action_suggestions": {
            "title": "运营建议",
            "actions": _actions(price, shops, top_terms),
        },
    }


def parse_price(price_text: str) -> float | None:
    if not price_text:
        return None
    normalized = price_text.replace(",", "")
    match = search(r"(\d+(?:\.\d+)?)", normalized)
    if not match:
        return None
    try:
        return float(Decimal(match.group(1)))
    except (InvalidOperation, ValueError):
        return None


def parse_sales(sales_text: str) -> int | None:
    if not sales_text:
        return None
    normalized = sales_text.replace(",", "").replace("＋", "+")
    match = search(r"(\d+(?:\.\d+)?)\s*(万)?\s*\+?", normalized)
    if not match:
        return None
    try:
        value = Decimal(match.group(1))
    except InvalidOperation:
        return None
    if match.group(2):
        value *= Decimal(10000)
    return int(value)


def _dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = str(item.get("item_url") or "").strip()
        if not key:
            key = f"{item.get('title', '')}|{item.get('shop_name', '')}|{item.get('price', '')}"
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _normalize_item(item: dict[str, Any], rank: int) -> NormalizedItem:
    title = _clean_text(item.get("title"))
    price_text = _clean_text(item.get("price"))
    sales_text = _clean_text(item.get("sales_text"))
    return NormalizedItem(
        title=title,
        price_text=price_text,
        price_value=parse_price(price_text),
        sales_text=sales_text,
        sales_value=parse_sales(sales_text),
        shop_name=_clean_text(item.get("shop_name")),
        item_url=_clean_text(item.get("item_url")),
        image_url=_clean_text(item.get("image_url")),
        rank=int(item.get("rank") or rank),
    )


def _item_for_prompt(item: NormalizedItem) -> dict[str, Any]:
    return {
        "title": item.title,
        "price": item.price_text,
        "sales_text": item.sales_text,
        "shop_name": item.shop_name,
        "rank": item.rank,
    }


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return sub(r"\s+", " ", str(value)).strip()


def _price_metrics(items: list[NormalizedItem]) -> dict[str, Any]:
    prices = sorted(item.price_value for item in items if item.price_value is not None)
    if not prices:
        return {"count": 0, "min": None, "max": None, "median": None, "bands": []}

    return {
        "count": len(prices),
        "min": round(prices[0], 2),
        "max": round(prices[-1], 2),
        "median": round(float(median(prices)), 2),
        "bands": _build_price_bands(prices),
    }


def _build_price_bands(prices: list[float]) -> list[dict[str, Any]]:
    max_price = max(prices)
    if max_price <= 50:
        edges = [0, 10, 20, 30, 50]
    elif max_price <= 200:
        edges = [0, 30, 50, 100, 200]
    elif max_price <= 1000:
        edges = [0, 100, 200, 500, 1000]
    else:
        edges = [0, 200, 500, 1000, 3000, max_price]

    bands: list[dict[str, Any]] = []
    for lower, upper in zip(edges, edges[1:]):
        count = sum(1 for price in prices if lower <= price < upper)
        bands.append({"label": f"{lower:g}-{upper:g}元", "min": lower, "max": upper, "count": count})
    overflow = sum(1 for price in prices if price >= edges[-1])
    if overflow:
        bands.append({"label": f"{edges[-1]:g}元以上", "min": edges[-1], "max": None, "count": overflow})
    return bands


def _sales_metrics(items: list[NormalizedItem]) -> dict[str, Any]:
    sales_values = sorted(item.sales_value for item in items if item.sales_value is not None)
    raw_counter = Counter(item.sales_text for item in items if item.sales_text)
    if not sales_values:
        return {
            "parsed_count": 0,
            "min": None,
            "max": None,
            "median": None,
            "raw_top_texts": _counter_to_list(raw_counter, 8),
        }
    return {
        "parsed_count": len(sales_values),
        "min": sales_values[0],
        "max": sales_values[-1],
        "median": int(median(sales_values)),
        "raw_top_texts": _counter_to_list(raw_counter, 8),
    }


def _shop_metrics(items: list[NormalizedItem]) -> dict[str, Any]:
    shop_counter = Counter(item.shop_name for item in items if item.shop_name)
    total = sum(shop_counter.values())
    top_shops = _counter_to_list(shop_counter, 10)
    top5_count = sum(shop["count"] for shop in top_shops[:5])
    return {
        "unique_shop_count": len(shop_counter),
        "duplicate_shop_count": sum(1 for count in shop_counter.values() if count > 1),
        "top5_concentration_ratio": round(top5_count / total, 4) if total else 0,
        "top_shops": top_shops,
    }


def _title_term_metrics(items: list[NormalizedItem]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    for item in items:
        counter.update(_extract_title_terms(item.title))
    return _counter_to_list(counter, 20)


def _extract_title_terms(title: str) -> list[str]:
    if not title:
        return []

    terms: list[str] = []
    for token in split(r"[\s｜|/\\,，.。:：;；【】\[\]()（）\-]+", title):
        token = token.strip()
        if not token:
            continue
        if search(r"[a-zA-Z0-9]", token):
            terms.extend(term.lower() for term in findall(r"[a-zA-Z0-9]{2,}", token))
        cjk_chunks = findall(r"[\u4e00-\u9fff]{2,}", token)
        for chunk in cjk_chunks:
            if len(chunk) <= 6:
                terms.append(chunk)
            else:
                terms.extend(chunk[index : index + 2] for index in range(len(chunk) - 1))
                terms.extend(chunk[index : index + 3] for index in range(len(chunk) - 2))

    return [term for term in terms if term not in _COMMON_TITLE_TERMS]


def _data_quality_metrics(items: list[NormalizedItem]) -> dict[str, Any]:
    total = len(items)
    missing_title = sum(1 for item in items if not item.title)
    missing_price = sum(1 for item in items if not item.price_text)
    missing_sales = sum(1 for item in items if not item.sales_text)
    missing_shop = sum(1 for item in items if not item.shop_name)
    return {
        "total": total,
        "missing_title": missing_title,
        "missing_price": missing_price,
        "missing_sales_text": missing_sales,
        "missing_shop_name": missing_shop,
    }


def _counter_to_list(counter: Counter[str], limit: int) -> list[dict[str, Any]]:
    return [{"term": key, "count": count} for key, count in counter.most_common(limit)]


def _top_bucket(bands: list[dict[str, Any]]) -> str:
    if not bands:
        return ""
    top = max(bands, key=lambda band: band["count"])
    if not top["count"]:
        return ""
    return str(top["label"])


def _value_or_empty(value: Any) -> str:
    if value is None or value == "":
        return "暂无"
    return str(value)


def _ratio_label(value: float | int, total: float | int) -> str:
    if not total:
        return "0%"
    ratio = float(value) / float(total)
    return f"{round(ratio * 100, 1)}%"


def _price_structure_conclusion(price: dict[str, Any]) -> str:
    median_price = price.get("median")
    top_band = _top_bucket(price.get("bands") or [])
    if median_price is None:
        return "当前页价格字段不足，暂时无法判断主流价格结构。"
    if top_band:
        return f"当前页主流价格集中在 {top_band}，价格中位数为 {median_price} 元。"
    return f"当前页价格中位数为 {median_price} 元，但价格带集中度不明显。"


def _competition_conclusion(shops: dict[str, Any]) -> str:
    ratio = shops.get("top5_concentration_ratio") or 0
    unique_count = shops.get("unique_shop_count") or 0
    if unique_count == 0:
        return "当前页店铺字段不足，暂时无法判断竞争集中度。"
    if ratio >= 0.5:
        return "当前页头部店铺集中度偏高，新品切入需要避开强势店铺的核心价格带和卖点。"
    if ratio >= 0.25:
        return "当前页已有一定头部集中，但仍存在分散店铺，适合寻找细分卖点切入。"
    return "当前页店铺分布较分散，第一页样本未显示明显垄断。"


def _demand_conclusion(top_terms: list[str]) -> str:
    if not top_terms:
        return "当前页标题词不足，暂时无法提炼稳定的需求信号。"
    return f"商家在标题中集中强调 {'、'.join(top_terms[:5])}，这些词可作为可见需求和卖点方向。"


def _sales_conclusion(sales: dict[str, Any]) -> str:
    parsed_count = sales.get("parsed_count") or 0
    median_sales = sales.get("median")
    if not parsed_count:
        return "当前页销量文本不足或不可解析，只能依据价格和标题做初步判断。"
    return f"当前页有 {parsed_count} 个商品可解析销量文本，中位销量约为 {median_sales}，可作为相对热度参考。"


def _opportunities(price: dict[str, Any], shops: dict[str, Any], top_terms: list[str]) -> list[str]:
    top_band = _top_bucket(price.get("bands") or [])
    terms = "、".join(top_terms[:4]) if top_terms else "可见高频卖点"
    ratio = shops.get("top5_concentration_ratio") or 0
    competition = "头部集中度不高" if ratio < 0.5 else "头部集中度较高"
    return [
        f"价格带机会：围绕 {top_band or '当前可见主流价格带'} 做成本和毛利验证，避免脱离第一页主流成交心智。",
        f"卖点差异化机会：以 {terms} 为基础组合标题和主图表达，再加入更具体的人群、场景或功能差异。",
        f"竞争切入机会：当前页{competition}，可优先寻找重复出现店铺尚未覆盖的细分卖点。",
    ]


def _risks(metrics: dict[str, Any]) -> list[str]:
    price = metrics["price"]
    shops = metrics["shops"]
    quality = metrics["data_quality"]
    return [
        f"样本偏差风险：当前只分析第一页 {quality.get('total', 0)} 个商品，不能代表全站规模、增速或季节性。",
        f"价格战风险：当前页价格范围为 {_value_or_empty(price.get('min'))}-{_value_or_empty(price.get('max'))} 元，低价切入前需要确认成本和利润空间。",
        f"头部挤压风险：Top5 店铺集中度为 {_ratio_label(shops.get('top5_concentration_ratio', 0), 1)}，集中度越高，新品越需要差异化定位。",
    ]


def _actions(price: dict[str, Any], shops: dict[str, Any], top_terms: list[str]) -> list[dict[str, str]]:
    top_band = _top_bucket(price.get("bands") or [])
    top_shop_names = [shop["term"] for shop in shops.get("top_shops", [])[:3]]
    return [
        {
            "title": "定价建议",
            "detail": f"优先围绕 {top_band or '当前页主流价格带'} 建立基础款价格，再用规格、设计或服务拉开高低档。",
        },
        {
            "title": "标题卖点建议",
            "detail": f"标题可覆盖 {'、'.join(top_terms[:5]) if top_terms else '当前页可见高频词'}，同时加入更细的人群或使用场景做区分。",
        },
        {
            "title": "竞品观察建议",
            "detail": f"优先观察 {'、'.join(top_shop_names) if top_shop_names else '第一页排名靠前店铺'} 的价格、标题和销量文本变化。",
        },
        {
            "title": "下一步补数建议",
            "detail": "补采多页和不同时间点样本后，再判断市场规模、增长趋势和促销节点波动。",
        },
    ]


def _price_opportunity(price: dict[str, Any]) -> str:
    median_price = price.get("median")
    bands = [band for band in price.get("bands", []) if band.get("count")]
    if median_price is None or not bands:
        return "价格数据不足，建议先扩大样本或检查页面字段识别。"
    top_band = max(bands, key=lambda band: band["count"])
    lower_band = next((band for band in bands if band.get("max") and band["max"] <= median_price), None)
    if lower_band and lower_band["count"] < top_band["count"]:
        return f"主流价格集中在 {top_band['label']}，低于中位数的价格带竞争相对少，可结合成本验证低价切入空间。"
    return f"主流价格集中在 {top_band['label']}，建议优先围绕该价格带做卖点差异化，而不是单纯降价。"
