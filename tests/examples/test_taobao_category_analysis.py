from types import SimpleNamespace

from fastapi.testclient import TestClient

from examples.taobao_category_analysis.backend.analysis import analyze_category, parse_price, parse_sales
from examples.taobao_category_analysis.backend.llm import generate_ai_summary
from examples.taobao_category_analysis.backend.main import app


def test_parse_price_and_sales_text():
    assert parse_price("￥129.90") == 129.9
    assert parse_price("12.5元") == 12.5
    assert parse_price("") is None

    assert parse_sales("1000+人付款") == 1000
    assert parse_sales("1.2万+人付款") == 12000
    assert parse_sales("") is None


def test_analyze_category_dedupes_items_and_builds_metrics(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "")
    payload = {
        "keyword": "连衣裙",
        "source_url": "https://s.taobao.com/search?q=%E8%BF%9E%E8%A1%A3%E8%A3%99",
        "captured_at": "2026-06-29T00:00:00Z",
        "items": [
            {
                "title": "夏季连衣裙女显瘦法式",
                "price": "￥129",
                "sales_text": "1000+人付款",
                "shop_name": "样例女装店",
                "item_url": "https://item.taobao.com/item.htm?id=1",
                "image_url": "https://img.example/1.jpg",
                "rank": 1,
            },
            {
                "title": "夏季连衣裙女显瘦法式",
                "price": "￥129",
                "sales_text": "1000+人付款",
                "shop_name": "样例女装店",
                "item_url": "https://item.taobao.com/item.htm?id=1",
                "image_url": "https://img.example/1.jpg",
                "rank": 2,
            },
            {
                "title": "通勤连衣裙高级感",
                "price": "￥259",
                "sales_text": "1.2万+人付款",
                "shop_name": "通勤衣橱",
                "item_url": "https://item.taobao.com/item.htm?id=2",
                "image_url": "https://img.example/2.jpg",
                "rank": 3,
            },
        ],
    }

    result = analyze_category(payload)

    assert result["items_count"] == 2
    assert result["metrics"]["price"]["median"] == 194.0
    assert result["metrics"]["sales"]["median"] == 6500
    assert result["metrics"]["shops"]["unique_shop_count"] == 2
    # New metrics assertions
    assert "sales_distribution" in result["metrics"]
    assert "top_item_contribution" in result["metrics"]
    assert "gmv_estimate" in result["metrics"]
    assert "category_heat" in result["metrics"]
    assert "top_products" in result["metrics"]
    assert "rank_sales_distribution" in result["metrics"]
    assert len(result["metrics"]["sales_distribution"]["bands"]) == 5
    assert result["metrics"]["gmv_estimate"]["total_gmv"] > 0
    assert 0 <= result["metrics"]["category_heat"]["score"] <= 100
    assert result["metrics"]["category_heat"]["level"] in ("高", "中高", "中", "中低", "低")
    assert len(result["metrics"]["top_products"]) == 2
    # Price bands now include sales data
    bands = result["metrics"]["price"]["bands"]
    assert all("sales_count" in b and "sales_sum" in b for b in bands)
    # Title terms now include demand_type
    terms = result["metrics"]["title_terms"]
    assert all("demand_type" in t and "percentage" in t for t in terms)
    # Shop top_shops now include sales_sum
    top_shops = result["metrics"]["shops"]["top_shops"]
    assert all("sales_sum" in s and "avg_price" in s for s in top_shops)
    assert "market_overview" in result["summary"]
    assert result["report"]["market_snapshot"]["title"] == "市场样本概况"
    assert result["report"]["price_structure"]["evidence"]
    assert result["report"]["sales_heat"]["conclusion"]
    assert len(result["report"]["opportunities_and_risks"]["opportunities"]) == 3
    assert len(result["report"]["action_suggestions"]["actions"]) == 4


def test_api_rejects_empty_items():
    client = TestClient(app)

    response = client.post(
        "/api/category-analysis",
        json={
            "keyword": "连衣裙",
            "source_url": "https://s.taobao.com/search?q=x",
            "captured_at": "2026-06-29T00:00:00Z",
            "items": [],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "商品列表（items）不能为空"


def test_api_returns_analysis_for_valid_items(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "")
    client = TestClient(app)

    response = client.post(
        "/api/category-analysis",
        json={
            "keyword": "耳机",
            "source_url": "https://s.taobao.com/search?q=%E8%80%B3%E6%9C%BA",
            "captured_at": "2026-06-29T00:00:00Z",
            "items": [
                {
                    "title": "蓝牙耳机降噪长续航",
                    "price": "￥99",
                    "sales_text": "3000+人付款",
                    "shop_name": "数码店A",
                    "item_url": "https://item.taobao.com/item.htm?id=11",
                    "image_url": "",
                    "rank": 1,
                }
            ],
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["items_count"] == 1
    assert body["metrics"]["price"]["median"] == 99
    assert body["summary"]["market_overview"]
    assert body["report"]["market_snapshot"]["conclusion"]
    assert body["report"]["demand_signals"]["evidence"]
    assert body["metrics"]["summary_source"] == "local"


def test_frontend_index_is_served():
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "类目洞察" in response.text


def test_llm_failure_falls_back_without_logging_secret(monkeypatch, caplog):
    class BrokenClient:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **_call_kwargs: (_ for _ in ()).throw(RuntimeError("network down"))
                )
            )

    monkeypatch.setenv("DASHSCOPE_API_KEY", "secret-test-key")
    monkeypatch.setitem(__import__("sys").modules, "openai", SimpleNamespace(OpenAI=BrokenClient))

    fallback = {
        "market_overview": "本地概览",
        "competition": "本地竞争",
        "price_opportunity": "本地机会",
        "title_suggestions": "本地标题",
        "risk_notes": "本地风险。",
    }
    fallback_report = {
        "market_snapshot": {"title": "市场样本概况"},
        "price_structure": {"title": "价格结构"},
        "competition_landscape": {"title": "竞争格局"},
        "demand_signals": {"title": "用户需求信号"},
        "sales_heat": {"title": "销量热度"},
        "opportunities_and_risks": {"title": "机会点与风险点", "risks": []},
        "action_suggestions": {"title": "运营建议"},
    }
    summary, report, source = generate_ai_summary(
        keyword="耳机",
        metrics={},
        sample_items=[],
        fallback_summary=fallback,
        fallback_report=fallback_report,
        request_id="request-1",
        analysis_id="analysis-1",
    )

    assert source == "local_fallback"
    assert summary["market_overview"] == "本地概览"
    assert report["market_snapshot"]["title"] == "市场样本概况"
    assert report["opportunities_and_risks"]["risks"]
    assert "secret-test-key" not in caplog.text


def test_llm_invalid_report_shape_falls_back(monkeypatch):
    class InvalidReportClient:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **_call_kwargs: SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(content='{"market_overview":"缺少新 report 结构"}')
                            )
                        ]
                    )
                )
            )

    monkeypatch.setenv("DASHSCOPE_API_KEY", "secret-test-key")
    monkeypatch.setitem(__import__("sys").modules, "openai", SimpleNamespace(OpenAI=InvalidReportClient))

    fallback_summary = {
        "market_overview": "本地概览",
        "competition": "本地竞争",
        "price_opportunity": "本地机会",
        "title_suggestions": "本地标题",
        "risk_notes": "本地风险。",
    }
    fallback_report = {
        "market_snapshot": {"title": "市场样本概况"},
        "price_structure": {"title": "价格结构"},
        "competition_landscape": {"title": "竞争格局"},
        "demand_signals": {"title": "用户需求信号"},
        "sales_heat": {"title": "销量热度"},
        "opportunities_and_risks": {"title": "机会点与风险点", "risks": []},
        "action_suggestions": {"title": "运营建议"},
    }

    summary, report, source = generate_ai_summary(
        keyword="耳机",
        metrics={},
        sample_items=[],
        fallback_summary=fallback_summary,
        fallback_report=fallback_report,
        request_id="request-2",
        analysis_id="analysis-2",
    )

    assert source == "local_fallback"
    assert summary == fallback_summary
    assert report == fallback_report
