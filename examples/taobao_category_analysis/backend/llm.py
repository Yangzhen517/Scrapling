from __future__ import annotations

from json import dumps, loads
from os import getenv
from pathlib import Path
from re import search
from time import perf_counter
from typing import Any

from .config import load_env_file
from .logging_utils import log_event


_SUMMARY_KEYS = {
    "market_overview",
    "competition",
    "price_opportunity",
    "title_suggestions",
    "risk_notes",
}
_REPORT_KEYS = {
    "market_snapshot",
    "price_structure",
    "competition_landscape",
    "demand_signals",
    "sales_heat",
    "opportunities_and_risks",
    "action_suggestions",
}


def generate_ai_summary(
    keyword: str,
    metrics: dict[str, Any],
    sample_items: list[dict[str, Any]],
    fallback_summary: dict[str, str],
    fallback_report: dict[str, Any],
    request_id: str = "",
    analysis_id: str = "",
) -> tuple[dict[str, str], dict[str, Any], str]:
    log_event("llm.config_load_started", request_id=request_id, analysis_id=analysis_id)
    load_env_file(Path(__file__).resolve().parent.parent / ".env")
    api_key = getenv("DASHSCOPE_API_KEY")
    if not api_key:
        log_event("llm.skipped", request_id=request_id, analysis_id=analysis_id, reason="missing_api_key")
        return fallback_summary, fallback_report, "local"

    started_at = perf_counter()
    model = getenv("DASHSCOPE_MODEL", "qwen3.6-plus")
    log_event(
        "llm.started",
        request_id=request_id,
        analysis_id=analysis_id,
        model=model,
        sample_items_count=len(sample_items),
        metric_sections=list(metrics.keys()),
    )
    try:
        from openai import OpenAI

        log_event("llm.client_init_started", request_id=request_id, analysis_id=analysis_id, model=model)
        client = OpenAI(
            api_key=api_key,
            base_url=getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        )
        log_event("llm.client_init_finished", request_id=request_id, analysis_id=analysis_id, model=model)
        messages = _build_messages(keyword, metrics, sample_items)
        log_event(
            "llm.messages_built",
            request_id=request_id,
            analysis_id=analysis_id,
            model=model,
            messages_count=len(messages),
        )
        log_event("llm.request_started", request_id=request_id, analysis_id=analysis_id, model=model)
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            extra_body={"enable_thinking": False},
            stream=False,
            timeout=30,
        )
        content = completion.choices[0].message.content or ""
        log_event(
            "llm.response_received",
            request_id=request_id,
            analysis_id=analysis_id,
            model=model,
            content_length=len(content),
        )
        parsed = _parse_summary_json(content)
        if parsed:
            log_event(
                "llm.succeeded",
                request_id=request_id,
                analysis_id=analysis_id,
                model=model,
                duration_ms=round((perf_counter() - started_at) * 1000, 2),
            )
            return parsed["summary"], parsed["report"], "llm"
        log_event(
            "llm.parse_returned_empty",
            request_id=request_id,
            analysis_id=analysis_id,
            model=model,
            content_length=len(content),
        )
    except Exception as exc:
        log_event(
            "llm.failed",
            request_id=request_id,
            analysis_id=analysis_id,
            model=model,
            error_type=type(exc).__name__,
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
        )
        fallback = dict(fallback_summary)
        fallback["risk_notes"] = f"{fallback['risk_notes']} 大模型摘要调用失败，已使用本地摘要。错误：{type(exc).__name__}"
        report = dict(fallback_report)
        risk_section = dict(report.get("opportunities_and_risks") or {})
        risks = list(risk_section.get("risks") or [])
        risks.append(f"大模型报告调用失败，已使用本地报告。错误：{type(exc).__name__}")
        risk_section["risks"] = risks
        report["opportunities_and_risks"] = risk_section
        return fallback, report, "local_fallback"

    log_event(
        "llm.invalid_response",
        request_id=request_id,
        analysis_id=analysis_id,
        model=model,
        duration_ms=round((perf_counter() - started_at) * 1000, 2),
    )
    return fallback_summary, fallback_report, "local_fallback"


def _build_messages(keyword: str, metrics: dict[str, Any], sample_items: list[dict[str, Any]]) -> list[dict[str, str]]:
    prompt_metrics = {
        "price": metrics.get("price"),
        "sales": metrics.get("sales"),
        "sales_distribution": metrics.get("sales_distribution"),
        "top_item_contribution": metrics.get("top_item_contribution"),
        "gmv_estimate": metrics.get("gmv_estimate"),
        "category_heat": metrics.get("category_heat"),
        "shops": metrics.get("shops"),
        "title_terms": metrics.get("title_terms"),
    }
    payload = {
        "keyword": keyword,
        "metrics": prompt_metrics,
        "sample_items": sample_items,
    }
    return [
        {
            "role": "system",
            "content": (
                "你是电商类目分析师。基于用户当前淘宝搜索结果第一页的结构化样本做分析。"
                "不要声称样本代表全站，不要编造看不到的数据。"
                "每条结论必须能从 metrics 或 sample_items 找到依据。"
                "禁止生成 GMV、订单数、用户数、同比增速、季节性、用户画像等当前数据无法证明的内容。"
                "只输出 JSON，不要 Markdown，不要额外解释。"
            ),
        },
        {
            "role": "user",
            "content": (
                "请根据以下数据生成类目分析报告。返回 JSON，顶层必须包含 summary 和 report。\n"
                "summary 必须包含这些字符串字段：market_overview（市场概览）、competition（竞争强度）、"
                "price_opportunity（价格机会）、title_suggestions（标题/卖点建议）、risk_notes（风险提示）。\n"
                "report 必须包含这些对象字段：market_snapshot（市场样本概况）、price_structure（价格结构）、"
                "competition_landscape（竞争格局）、demand_signals（用户需求信号）、sales_heat（销量热度）、"
                "opportunities_and_risks（机会点与风险点）、action_suggestions（运营建议）。\n"
                "market_snapshot、price_structure、competition_landscape、demand_signals、sales_heat 每个对象包含 "
                "title、conclusion、evidence、suggestion；evidence 为字符串数组。"
                "opportunities_and_risks 包含 title、opportunities、risks；opportunities 和 risks 均为字符串数组。"
                "action_suggestions 包含 title、actions；actions 为对象数组，每项包含 title 和 detail。\n\n"
                f"{dumps(payload, ensure_ascii=False)}"
            ),
        },
    ]


def _parse_summary_json(content: str) -> dict[str, Any] | None:
    text = content.strip()
    if not text:
        return None

    if text.startswith("```"):
        match = search(r"```(?:json)?\s*(.*?)\s*```", text, flags=16)
        if match:
            text = match.group(1)

    try:
        parsed = loads(text)
    except ValueError:
        return None

    if not isinstance(parsed, dict):
        return None

    summary = parsed.get("summary")
    report = parsed.get("report")
    if not isinstance(summary, dict) or not isinstance(report, dict):
        return None
    if not _SUMMARY_KEYS.issubset(summary) or not _REPORT_KEYS.issubset(report):
        return None

    return {
        "summary": {key: str(summary[key]).strip() for key in _SUMMARY_KEYS},
        "report": report,
    }
