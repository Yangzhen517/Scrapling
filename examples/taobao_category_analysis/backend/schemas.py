from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CategoryItem(BaseModel):
    title: str = Field("", description="商品标题：商品卡片标题")
    price: str = Field("", description="价格：商品价格原文")
    sales_text: str = Field("", description="销量文本：如“1000+人付款”")
    shop_name: str = Field("", description="店铺名：商品所属店铺")
    item_url: str = Field("", description="商品链接：商品详情页链接")
    image_url: str = Field("", description="图片链接：商品主图链接")
    rank: int = Field(0, description="页面排名：按当前页出现顺序生成")


class CategoryAnalysisRequest(BaseModel):
    keyword: str = Field("", description="类目/关键词：搜索词或类目名")
    source_url: str = Field("", description="来源页面：当前淘宝搜索页 URL")
    captured_at: str = Field("", description="采集时间：插件采集时间，ISO 字符串")
    items: list[CategoryItem] = Field(default_factory=list, description="商品列表：当前页商品数组")


class CategoryAnalysisResponse(BaseModel):
    analysis_id: str = Field(..., description="分析ID：本次分析唯一标识")
    items_count: int = Field(..., description="商品数量：实际参与分析的商品数量")
    metrics: dict[str, Any] = Field(..., description="统计指标：价格、销量文本、店铺、标题词等统计结果")
    summary: dict[str, str] = Field(..., description="分析摘要：类目分析结论")
    report: dict[str, Any] = Field(..., description="类目分析报告：基于当前页样本生成的结构化选品运营诊断")
