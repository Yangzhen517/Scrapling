# 类目洞察 Pro 仪表盘升级计划

## Context

当前淘宝类目分析项目是一个 MVP 级别的 Chrome 插件 + FastAPI 后端 + 简单前端。前端使用浅色主题，只有 4 个指标卡片和文本形式的报告。需要将其升级为专业级数据分析仪表盘，包含丰富的可视化图表（环形图、柱状图、折线图、词云）、多维度指标卡片、结构化 Tab 导航，支持市场概览、价格分析、竞争格局、需求洞察、机会与风险、商品列表等多个分析维度。

**设计约束**：白色/浅色背景 + 蓝紫色系强调色，无侧边栏（仅保留类目洞察页面），Chrome 插件采集逻辑不变，不引入 React/Vue 框架和构建工具。

---

## Task 1: 后端数据扩展 — 新增分析维度

**文件**: `backend/analysis.py`

在现有 `analyze_category()` 的 `metrics` 字典中新增以下子模块：

### 1.1 新增 `_sales_distribution_metrics()`
- 将商品按销量值分为 5 个区间：10000以上、5000-10000、1000-5000、500-1000、500以下
- 每个区间返回 `label`、`count`、`percentage`
- 返回 `total_parsed`（可解析销量的商品总数）

### 1.2 新增 `_top_item_contribution_metrics()`
- 按 sales_value 降序排列，分为 TOP5/TOP6-10/TOP11-20/TOP21-30/其他
- 每组返回 `label`、`sales_sum`、`percentage`
- 返回 `total_sales`（全部可解析销量合计）

### 1.3 新增 `_gmv_estimate()`
- 计算 `price_value * sales_value`（两者都不为 None 的商品）
- 返回 `total_gmv`、`item_count`、`avg_gmv`、`gmv_label`（格式化文本如"约 782 万元"）
- 同时计算 `total_sales_estimate`（样本销量估算）

### 1.4 新增 `_category_heat_score()`
- 综合销量中位数、商品数量、店铺数量加权评分 0-100
- 返回 `score`（0-100）和 `level`（"高"/"中高"/"中"/"中低"/"低"）及描述文本

### 1.5 新增 `_top_products()`
- 按 sales_value 降序取前 10
- 每项包含 `title`、`price`、`sales_value`、`sales_text`、`shop_name`、`image_url`、`item_url`、`rank`

### 1.6 增强 `_build_price_bands()` 
- 每个价格带增加 `sales_count`（有销量数据的商品数）、`sales_sum`（销量合计）、`sales_percentage`（销量占比）

### 1.7 增强 `_shop_metrics()` 
- 每个 top_shops 项增加 `sales_sum`（店铺所有商品销量合计）、`avg_price`（平均价格）、`item_count`（商品数）

### 1.8 增强 `_title_term_metrics()`
- 每个高频词增加 `percentage`（出现次数/商品总数）
- 增加 `demand_type` 分类：通过关键词映射表标注"功能属性"/"使用场景"/"人群定位"/"材质工艺"/"品牌风格"

### 1.9 新增 `_rank_sales_distribution()`
- 用页面 rank 与销量关系替代无法实现的"时间趋势"
- 返回每项 `rank`、`title`、`sales_value`、`price_value`

### 1.10 在 `analyze_category()` 中组装
```python
metrics = {
    "price": _price_metrics(...),           # 已增强
    "sales": _sales_metrics(...),           # 不变
    "sales_distribution": _sales_distribution_metrics(...),  # 新增
    "top_item_contribution": _top_item_contribution_metrics(...),  # 新增
    "gmv_estimate": _gmv_estimate(...),     # 新增
    "category_heat": _category_heat_score(...),  # 新增
    "top_products": _top_products(...),     # 新增
    "rank_sales_distribution": _rank_sales_distribution(...),  # 新增
    "shops": _shop_metrics(...),            # 已增强
    "title_terms": _title_term_metrics(...),  # 已增强
    "data_quality": _data_quality_metrics(...),  # 不变
}
```

### 1.11 更新 LLM Prompt (`backend/llm.py`)
- 在 `_build_messages()` 的 user message 中传入新 metrics 数据（sales_distribution、gmv_estimate、top_item_contribution、category_heat）
- 让 LLM 生成更丰富的 AI 洞察结论

---

## Task 2: 前端基础框架 — 浅色主题 + 页面骨架

### 2.1 文件结构
```
frontend/
├── index.html              # 主页面骨架（顶栏搜索 + 指标卡片 + Tab + 内容区）
├── styles.css              # 单文件 CSS（浅色主题 + 所有组件样式）
├── app.js                  # 入口 + 事件绑定 + 消息通信 + Tab 路由
├── renderers.js            # 各 Tab 页面的渲染函数
├── charts.js               # ECharts 图表封装（环形图、柱状图、gauge、折线图）
```

### 2.2 CSS 色板设计（白色/浅色 + 蓝紫色系）
```css
:root {
    --bg-base: #f5f7fa;
    --bg-surface: #ffffff;
    --bg-hover: #f0f2f8;
    --text-primary: #1a1d26;
    --text-secondary: #6b7280;
    --text-muted: #9ca3af;
    --border: #e5e7eb;
    --accent-primary: #6366f1;  /* 蓝紫色主色 */
    --accent-secondary: #8b5cf6;
    --accent-blue: #3b82f6;
    --accent-green: #10b981;
    --accent-orange: #f59e0b;
    --accent-red: #ef4444;
}
```

### 2.3 `index.html` 页面结构
```
<body>
  <header> 品牌标识"类目洞察 Pro" + 搜索框 + 操作按钮 </header>
  <div class="metric-cards"> 7个核心指标卡片横排 </div>
  <nav class="tab-nav"> 市场概览 | 价格分析 | 竞争格局 | 需求洞察 | 机会与风险 | 商品列表 </nav>
  <main class="tab-content"> 动态渲染各Tab内容 </main>
  <footer> 数据来源说明 </footer>
</body>
```

CDN 引入:
- ECharts 5: `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`
- echarts-wordcloud: `https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js`

---

## Task 3: ECharts 图表模块开发

**文件**: `frontend/charts.js`

| 图表 | 函数 | ECharts 类型 | 用途 |
|------|------|-------------|------|
| 销量分布环形图 | `renderSalesDonut()` | pie (doughnut) | 5个销量区间占比 |
| TOP商品贡献度环形图 | `renderContributionDonut()` | pie (doughnut) | TOP5/6-10/11-20/21-30/其他 |
| 类目热度仪表 | `renderHeatGauge()` | gauge | 0-100分环形进度条 |
| 价格带柱状图 | `renderPriceBar()` | bar (grouped) | 商品数占比 vs 销量占比 |
| Rank-Sales分布图 | `renderRankSalesLine()` | scatter/line | rank与销量关系 |
| 词云 | `renderWordCloud()` | echarts-wordcloud | 高频标题词可视化 |

---

## Task 4: Tab 页面渲染器

**文件**: `frontend/renderers.js`

### 4.1 核心指标卡片 `renderMetricsCards(data)`
7个卡片: 样本商品数 / 有效价格商品 / 有效销量商品 / 覆盖店铺数 / 样本销量估算 / 样本销售预估 / 类目热度评级(内嵌gauge)

### 4.2 市场概览 Tab `renderMarketOverview(data)`
三列布局:
- 左列: 销量分布环形图 + Rank-Sales 分布图
- 中列: TOP商品销量贡献度环形图
- 右列: AI 洞察速览卡片（4项结论 + 图标）

### 4.3 价格分析 Tab `renderPriceAnalysis(data)`
- 上方: 价格带柱状图（双系列）
- 下方: 数据表格（价格段/商品数/占比/销量/占比）

### 4.4 竞争格局 Tab `renderCompetition(data)`
- TOP 店铺榜表格 + 市场集中度指标卡 + AI洞察

### 4.5 需求洞察 Tab `renderDemandInsights(data)`
- 左: 词云图，右: 高频词TOP10表格（含需求类型），底部: AI洞察

### 4.6 机会与风险 Tab `renderOpportunities(data)`
- 左列: 机会点列表（图标+描述），右列: 风险点列表

### 4.7 商品列表 Tab `renderTopProducts(data)`
- 卡片网格: 商品图片 + 标题 + 价格 + 销量 + 店铺名 + TOP排名标记

---

## Task 5: 集成与入口逻辑

**文件**: `frontend/app.js`

- Chrome 插件通信保持不变（`window.postMessage` 协议）
- Tab 路由: 点击 Tab → 更新 state → 渲染对应内容
- ECharts 实例在切换 Tab 时 dispose 并重建
- `renderAll(data)` 主渲染函数: 渲染指标卡片 + 当前 Tab 内容
- 导出报告: `window.print()` 打印友好版

---

## Task 6: 测试验证

1. 启动后端: `python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
2. Chrome 加载插件 → 打开 `http://127.0.0.1:8000/`
3. 输入关键词 → 点击"开始分析"
4. 验证所有指标卡片、图表、Tab 页面正常渲染

---

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `backend/analysis.py` | **修改** — 新增 7 个分析函数 + 增强 3 个现有函数 |
| `backend/llm.py` | **修改** — 更新 prompt 传入新 metrics |
| `frontend/index.html` | **重写** — 新页面骨架 |
| `frontend/styles.css` | **重写** — 浅色主题 + 蓝紫色系 |
| `frontend/app.js` | **重写** — 入口 + 通信 + Tab 路由 |
| `frontend/renderers.js` | **新建** — 各 Tab 渲染函数 |
| `frontend/charts.js` | **新建** — ECharts 图表封装 |

**不变**: extension/ 下所有文件、schemas.py、config.py、logging_utils.py、main.py
