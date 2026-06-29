from __future__ import annotations

from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .analysis import analyze_category
from .config import load_env_file
from .logging_utils import configure_logging, log_event
from .schemas import CategoryAnalysisRequest, CategoryAnalysisResponse


configure_logging()
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
load_env_file(BASE_DIR / ".env")

app = FastAPI(
    title="Taobao Category Analysis MVP",
    description="淘宝类目分析 MVP 后端：接收 Chrome 插件采集的第一页商品数据并返回市场概览。",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")


@app.get("/")
def index() -> FileResponse:
    log_event("frontend.index_served")
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    log_event("health.checked")
    return {"status": "ok"}


@app.post("/api/category-analysis", response_model=CategoryAnalysisResponse)
def create_category_analysis(request: CategoryAnalysisRequest) -> CategoryAnalysisResponse:
    request_id = str(uuid4())
    analysis_id = str(uuid4())
    started_at = perf_counter()
    log_event(
        "analysis.request_started",
        request_id=request_id,
        analysis_id=analysis_id,
        keyword=request.keyword,
        items_received=len(request.items),
        source_host=_source_host(request.source_url),
    )
    log_event(
        "analysis.request_validation_started",
        request_id=request_id,
        analysis_id=analysis_id,
        keyword_present=bool(request.keyword),
        source_url_present=bool(request.source_url),
        captured_at_present=bool(request.captured_at),
    )
    if not request.items:
        log_event(
            "analysis.request_rejected",
            request_id=request_id,
            analysis_id=analysis_id,
            reason="empty_items",
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
        )
        raise HTTPException(status_code=400, detail="商品列表（items）不能为空")
    log_event(
        "analysis.request_validation_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        status="accepted",
    )

    log_event("analysis.payload_dump_started", request_id=request_id, analysis_id=analysis_id)
    payload = request.model_dump() if hasattr(request, "model_dump") else request.dict()
    log_event(
        "analysis.payload_dump_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        payload_items_count=len(payload.get("items") or []),
    )
    log_event("analysis.pipeline_started", request_id=request_id, analysis_id=analysis_id)
    result = analyze_category(payload, request_id=request_id, analysis_id=analysis_id)
    log_event(
        "analysis.pipeline_finished",
        request_id=request_id,
        analysis_id=analysis_id,
        raw_items_count=result["raw_items_count"],
        items_count=result["items_count"],
    )
    if result["items_count"] <= 0:
        log_event(
            "analysis.request_rejected",
            request_id=request_id,
            analysis_id=analysis_id,
            reason="no_valid_items",
            raw_items_count=result["raw_items_count"],
            duration_ms=round((perf_counter() - started_at) * 1000, 2),
        )
        raise HTTPException(status_code=400, detail="商品列表（items）没有可分析的有效商品")

    metrics = result["metrics"]
    log_event(
        "analysis.response_build_started",
        request_id=request_id,
        analysis_id=analysis_id,
        summary_source=metrics["summary_source"],
    )
    response = CategoryAnalysisResponse(
        analysis_id=analysis_id,
        items_count=result["items_count"],
        metrics=metrics,
        summary=result["summary"],
        report=result["report"],
    )
    log_event(
        "analysis.request_completed",
        request_id=request_id,
        analysis_id=analysis_id,
        keyword=request.keyword,
        raw_items_count=result["raw_items_count"],
        deduped_items_count=result["items_count"],
        missing_fields=metrics["data_quality"],
        price_parsed_count=metrics["price"]["count"],
        sales_parsed_count=metrics["sales"]["parsed_count"],
        summary_source=metrics["summary_source"],
        response_report_sections=list(result["report"].keys()),
        duration_ms=round((perf_counter() - started_at) * 1000, 2),
    )
    return response


def _source_host(source_url: str) -> str:
    if not source_url:
        return ""
    try:
        from urllib.parse import urlparse

        return urlparse(source_url).netloc
    except Exception:
        return ""
