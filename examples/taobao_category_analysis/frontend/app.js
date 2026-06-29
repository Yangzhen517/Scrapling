const form = document.getElementById("analysisForm");
const keywordInput = document.getElementById("keyword");
const startButton = document.getElementById("startButton");
const statusBox = document.getElementById("status");

const fields = {
  itemsCount: document.getElementById("itemsCount"),
  medianPrice: document.getElementById("medianPrice"),
  shopCount: document.getElementById("shopCount"),
  summarySource: document.getElementById("summarySource"),
  reportBlocks: document.getElementById("reportBlocks"),
  summaryBlocks: document.getElementById("summaryBlocks"),
  priceBands: document.getElementById("priceBands"),
  titleTerms: document.getElementById("titleTerms"),
  topShops: document.getElementById("topShops")
};
let extensionTimeoutId = null;

function logStep(event, fields = {}) {
  console.info("[taobao-category]", event, {
    at: new Date().toISOString(),
    page_url: window.location.href,
    ...fields
  });
}

function setStatus(message, state = "idle") {
  logStep("frontend.status_changed", { state, message });
  statusBox.textContent = message;
  statusBox.dataset.state = state;
}

function setRunning(isRunning) {
  logStep("frontend.running_state_changed", { is_running: isRunning });
  startButton.disabled = isRunning;
  startButton.textContent = isRunning ? "分析中" : "开始分析";
}

function clearExtensionTimeout() {
  if (extensionTimeoutId) {
    clearTimeout(extensionTimeoutId);
    extensionTimeoutId = null;
  }
}

function sourceLabel(value) {
  return {
    llm: "大模型",
    local: "本地",
    local_fallback: "本地回退"
  }[value] || value || "-";
}

function renderAnalysis(result) {
  logStep("frontend.render_started", {
    analysis_id: result.analysis_id || "",
    items_count: result.items_count || 0,
    summary_source: result.metrics?.summary_source || ""
  });
  const metrics = result.metrics || {};
  const price = metrics.price || {};
  const shops = metrics.shops || {};
  const summary = result.summary || {};
  const report = result.report || {};

  fields.itemsCount.textContent = result.items_count ?? "-";
  fields.medianPrice.textContent = price.median == null ? "-" : `${price.median} 元`;
  fields.shopCount.textContent = shops.unique_shop_count ?? "-";
  fields.summarySource.textContent = sourceLabel(metrics.summary_source);

  const summaryItems = [
    ["市场概览", summary.market_overview],
    ["竞争强度", summary.competition],
    ["价格机会", summary.price_opportunity],
    ["标题/卖点建议", summary.title_suggestions],
    ["风险提示", summary.risk_notes]
  ];
  fields.summaryBlocks.innerHTML = summaryItems
    .map(([label, text]) => `<div class="summary-card"><strong>${escapeHtml(label)}</strong>${escapeHtml(text || "暂无")}</div>`)
    .join("");

  renderReport(report);
  renderPriceBands(price.bands || []);
  renderTerms(metrics.title_terms || []);
  renderShops(shops.top_shops || []);
  logStep("frontend.render_finished", { analysis_id: result.analysis_id || "" });
}

function renderReport(report) {
  const sections = [
    report.market_snapshot,
    report.price_structure,
    report.competition_landscape,
    report.demand_signals,
    report.sales_heat
  ].filter(Boolean);

  const opportunitySection = report.opportunities_and_risks;
  const actionSection = report.action_suggestions;
  const blocks = sections.map(renderNarrativeSection);

  if (opportunitySection) {
    blocks.push(renderOpportunitySection(opportunitySection));
  }
  if (actionSection) {
    blocks.push(renderActionSection(actionSection));
  }

  fields.reportBlocks.innerHTML = blocks.length
    ? blocks.join("")
    : `<p class="placeholder">暂无结构化报告</p>`;
}

function renderNarrativeSection(section) {
  const evidence = Array.isArray(section.evidence) ? section.evidence : [];
  return `
    <section class="report-section">
      <div class="report-heading">
        <span>${escapeHtml(section.title || "报告区块")}</span>
        <strong>${escapeHtml(section.conclusion || "暂无结论")}</strong>
      </div>
      ${renderList("数据依据", evidence)}
      <p class="report-suggestion"><b>建议</b>${escapeHtml(section.suggestion || "暂无建议")}</p>
    </section>
  `;
}

function renderOpportunitySection(section) {
  return `
    <section class="report-section split-report">
      <div>
        <div class="report-heading compact"><span>${escapeHtml(section.title || "机会点与风险点")}</span><strong>机会点</strong></div>
        ${renderList("", section.opportunities || [])}
      </div>
      <div>
        <div class="report-heading compact"><span>风险点</span><strong>需要验证</strong></div>
        ${renderList("", section.risks || [])}
      </div>
    </section>
  `;
}

function renderActionSection(section) {
  const actions = Array.isArray(section.actions) ? section.actions : [];
  return `
    <section class="report-section">
      <div class="report-heading"><span>${escapeHtml(section.title || "运营建议")}</span><strong>下一步动作</strong></div>
      <div class="action-grid">
        ${actions.map((action) => `
          <div class="action-item">
            <strong>${escapeHtml(action.title || "建议")}</strong>
            <p>${escapeHtml(action.detail || "")}</p>
          </div>
        `).join("") || `<p class="placeholder">暂无行动建议</p>`}
      </div>
    </section>
  `;
}

function renderList(label, values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) {
    return `<p class="placeholder">暂无${label || "数据"}</p>`;
  }
  return `
    <div class="report-list">
      ${label ? `<b>${escapeHtml(label)}</b>` : ""}
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderPriceBands(bands) {
  const max = Math.max(1, ...bands.map((band) => band.count || 0));
  fields.priceBands.innerHTML = bands.length
    ? bands.map((band) => {
        const width = Math.round(((band.count || 0) / max) * 100);
        return `<div class="bar-row"><span>${escapeHtml(band.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><b>${band.count || 0}</b></div>`;
      }).join("")
    : `<p class="placeholder">暂无价格带数据</p>`;
}

function renderTerms(terms) {
  fields.titleTerms.innerHTML = terms.length
    ? terms.slice(0, 12).map((term) => `<span class="term"><b>${escapeHtml(term.term)}</b><em>${term.count}</em></span>`).join("")
    : `<p class="placeholder">暂无高频词</p>`;
}

function renderShops(shops) {
  fields.topShops.innerHTML = shops.length
    ? shops.map((shop) => `<div class="shop-row"><span>${escapeHtml(shop.term)}</span><strong>${shop.count}</strong></div>`).join("")
    : `<p class="placeholder">暂无店铺数据</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const keyword = keywordInput.value.trim();
  logStep("frontend.submit_received", { keyword });
  if (!keyword) {
    setStatus("请输入类目名称", "error");
    return;
  }

  setRunning(true);
  setStatus("正在请求插件打开淘宝搜索页...", "running");
  clearExtensionTimeout();
  extensionTimeoutId = setTimeout(() => {
    logStep("frontend.extension_timeout", { timeout_ms: 12000, keyword });
    setRunning(false);
    setStatus("未检测到 Chrome 插件响应。请确认已加载并启用“淘宝类目分析助手”。", "error");
  }, 12000);
  logStep("frontend.start_message_posted", { keyword });
  window.postMessage({ source: "taobao-category-page", type: "START_CATEGORY_ANALYSIS", keyword }, window.location.origin);
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "taobao-category-extension") {
    return;
  }

  if (event.data.type === "CATEGORY_ANALYSIS_PROGRESS") {
    logStep("frontend.progress_received", { message: event.data.message || "" });
    clearExtensionTimeout();
    setStatus(event.data.message || "分析进行中...", "running");
    return;
  }

  if (event.data.type === "CATEGORY_ANALYSIS_RESULT") {
    logStep("frontend.result_received", {
      analysis_id: event.data.result?.analysis_id || "",
      items_count: event.data.result?.items_count || 0
    });
    clearExtensionTimeout();
    renderAnalysis(event.data.result);
    setStatus(`分析完成，分析ID：${event.data.result.analysis_id}`, "idle");
    setRunning(false);
    return;
  }

  if (event.data.type === "CATEGORY_ANALYSIS_ERROR") {
    logStep("frontend.error_received", { message: event.data.message || "分析失败" });
    clearExtensionTimeout();
    setStatus(event.data.message || "分析失败", "error");
    setRunning(false);
  }
});

setStatus("插件准备就绪后，输入类目名称即可启动分析。");
