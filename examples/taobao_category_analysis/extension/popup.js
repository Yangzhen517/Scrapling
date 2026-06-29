const analyzeButton = document.getElementById("analyzeButton");
const pageState = document.getElementById("pageState");
const statusBox = document.getElementById("status");
const resultBox = document.getElementById("result");
const apiUrlInput = document.getElementById("apiUrl");

let activeTab = null;

function logStep(event, fields = {}) {
  console.info("[taobao-category]", event, {
    at: new Date().toISOString(),
    ...fields
  });
}

function logError(event, error, fields = {}) {
  console.error("[taobao-category]", event, {
    at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    ...fields
  });
}

function setStatus(message) {
  logStep("popup.status_changed", { message });
  statusBox.textContent = message;
}

function isTaobaoSearchUrl(url) {
  return /^https?:\/\/[^/]*(taobao|tmall)\.com\//i.test(url || "") && /(search|s\.taobao|list|market|q=|keyword=)/i.test(url || "");
}

function renderResult(response) {
  logStep("popup.render_started", {
    analysis_id: response.analysis_id || "",
    items_count: response.items_count || 0,
    summary_source: response.metrics?.summary_source || ""
  });
  const price = response.metrics.price || {};
  const shops = response.metrics.shops || {};
  const terms = response.metrics.title_terms || [];
  const summary = response.summary || {};

  resultBox.hidden = false;
  resultBox.innerHTML = `
    <div class="metric"><strong>商品数量</strong><span>${response.items_count}</span></div>
    <div class="metric"><strong>价格中位数</strong><span>${price.median ?? "暂无"} 元</span></div>
    <div class="metric"><strong>价格范围</strong><span>${price.min ?? "暂无"} - ${price.max ?? "暂无"}</span></div>
    <div class="metric"><strong>店铺数量</strong><span>${shops.unique_shop_count ?? 0}</span></div>
    <div class="metric"><strong>高频词</strong><span>${terms.slice(0, 6).map((term) => term.term).join("、") || "暂无"}</span></div>
    <div class="summary">${summary.market_overview || ""}</div>
    <div class="summary">${summary.competition || ""}</div>
    <div class="summary">${summary.price_opportunity || ""}</div>
  `;
  logStep("popup.render_finished", { analysis_id: response.analysis_id || "" });
}

async function getActiveTab() {
  logStep("popup.active_tab_query_started");
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] || null;
  logStep("popup.active_tab_query_finished", { tab_id: tab?.id || null, url: tab?.url || "" });
  return tab;
}

async function collectPage(tabId) {
  logStep("popup.collect_started", { tab_id: tabId });
  return chrome.tabs.sendMessage(tabId, { type: "COLLECT_TAOBAO_PAGE" });
}

async function postAnalysis(payload) {
  const startedAt = Date.now();
  const apiUrl = apiUrlInput.value.trim();
  logStep("popup.api_request_started", {
    api_url: apiUrl,
    keyword: payload.keyword || "",
    items_count: payload.items?.length || 0
  });
  const response = await fetch(apiUrlInput.value.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `后端返回错误：${response.status}`);
  }
  logStep("popup.api_request_succeeded", {
    api_url: apiUrl,
    status: response.status,
    analysis_id: body.analysis_id || "",
    duration_ms: Date.now() - startedAt
  });
  return body;
}

analyzeButton.addEventListener("click", async () => {
  logStep("popup.analyze_clicked", { tab_id: activeTab?.id || null, url: activeTab?.url || "" });
  resultBox.hidden = true;
  analyzeButton.disabled = true;
  setStatus("正在采集当前页商品...");

  try {
    const collected = await collectPage(activeTab.id);
    if (!collected || !collected.ok) {
      throw new Error(collected?.error || "页面采集脚本没有返回结果");
    }
    logStep("popup.collect_finished", { items_count: collected.payload?.items?.length || 0 });
    if (!collected.payload.items.length) {
      setStatus("当前页未识别到商品数据。请确认已打开淘宝搜索结果页。");
      return;
    }

    setStatus(`已采集 ${collected.payload.items.length} 个商品，正在分析...`);
    const response = await postAnalysis(collected.payload);
    renderResult(response);
    setStatus(`分析完成，分析ID：${response.analysis_id}`);
  } catch (error) {
    logError("popup.analysis_failed", error, { tab_id: activeTab?.id || null });
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    analyzeButton.disabled = !activeTab || !isTaobaoSearchUrl(activeTab.url);
  }
});

(async function init() {
  logStep("popup.init_started");
  activeTab = await getActiveTab();
  if (!activeTab || !isTaobaoSearchUrl(activeTab.url)) {
    logStep("popup.init_finished", { state: "unsupported_page", url: activeTab?.url || "" });
    pageState.textContent = "非淘宝搜索页";
    setStatus("请先打开淘宝搜索结果页，再点击插件。");
    analyzeButton.disabled = true;
    return;
  }

  pageState.textContent = "可采集";
  setStatus("准备就绪。插件只采集当前页可见商品，不读取 Cookie。");
  analyzeButton.disabled = false;
  logStep("popup.init_finished", { state: "ready", tab_id: activeTab.id, url: activeTab.url || "" });
})();
