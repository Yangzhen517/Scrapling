const COLLECT_RETRY_LIMIT = 12;
const COLLECT_RETRY_DELAY_MS = 800;

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

function notify(tabId, type, payload = {}) {
  logStep("extension.notify", { tab_id: tabId, type, message: payload.message || "" });
  chrome.tabs.sendMessage(tabId, { type, ...payload }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId) {
  logStep("extension.wait_tab_started", { tab_id: tabId });
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") {
    logStep("extension.wait_tab_already_complete", { tab_id: tabId, url: current.url || "" });
    return;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("淘宝搜索页加载超时"));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        logStep("extension.wait_tab_completed", { tab_id: tabId });
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectFromTaobao(tabId) {
  for (let attempt = 1; attempt <= COLLECT_RETRY_LIMIT; attempt += 1) {
    try {
      logStep("extension.collect_attempt_started", { tab_id: tabId, attempt, retry_limit: COLLECT_RETRY_LIMIT });
      const response = await chrome.tabs.sendMessage(tabId, { type: "COLLECT_TAOBAO_PAGE" });
      if (response?.ok) {
        logStep("extension.collect_attempt_succeeded", {
          tab_id: tabId,
          attempt,
          items_count: response.payload?.items?.length || 0,
          source_url: response.payload?.source_url || ""
        });
        return response.payload;
      }
      throw new Error(response?.error || "淘宝页面采集失败");
    } catch (error) {
      logError("extension.collect_attempt_failed", error, { tab_id: tabId, attempt });
      if (attempt === COLLECT_RETRY_LIMIT) {
        throw error;
      }
      await sleep(COLLECT_RETRY_DELAY_MS);
    }
  }
  throw new Error("淘宝页面采集失败");
}

async function postAnalysis(payload, apiUrl) {
  const startedAt = Date.now();
  logStep("extension.api_request_started", {
    api_url: apiUrl,
    keyword: payload.keyword || "",
    items_count: payload.items?.length || 0
  });
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `后端返回错误：${response.status}`);
  }
  logStep("extension.api_request_succeeded", {
    api_url: apiUrl,
    status: response.status,
    analysis_id: body.analysis_id || "",
    duration_ms: Date.now() - startedAt
  });
  return body;
}

async function runAnalysis(keyword, sourceTabId) {
  let taobaoTabId = null;
  try {
    logStep("extension.analysis_started", { keyword, source_tab_id: sourceTabId });
    const sourceTab = await chrome.tabs.get(sourceTabId);
    const apiUrl = `${new URL(sourceTab.url).origin}/api/category-analysis`;
    logStep("extension.source_tab_loaded", { source_tab_id: sourceTabId, source_url: sourceTab.url || "", api_url: apiUrl });

    notify(sourceTabId, "CATEGORY_ANALYSIS_PROGRESS", { message: "正在打开淘宝搜索第一页..." });
    const taobaoUrl = `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`;
    logStep("extension.taobao_tab_create_started", { keyword, taobao_url: taobaoUrl });
    const tab = await chrome.tabs.create({ url: taobaoUrl, active: false });
    taobaoTabId = tab.id;
    logStep("extension.taobao_tab_created", { taobao_tab_id: taobaoTabId, taobao_url: tab.url || taobaoUrl });
    await waitForTabComplete(taobaoTabId);
    await sleep(1800);
    logStep("extension.taobao_tab_settle_finished", { taobao_tab_id: taobaoTabId, wait_ms: 1800 });

    notify(sourceTabId, "CATEGORY_ANALYSIS_PROGRESS", { message: "正在采集第一页可见商品..." });
    const payload = await collectFromTaobao(taobaoTabId);
    if (!payload.items?.length) {
      throw new Error("当前页未识别到商品数据，可能遇到登录、验证码或页面结构变化。");
    }
    payload.keyword = keyword;
    logStep("extension.payload_ready", {
      keyword: payload.keyword || "",
      items_count: payload.items?.length || 0,
      source_url: payload.source_url || "",
      captured_at: payload.captured_at || ""
    });

    notify(sourceTabId, "CATEGORY_ANALYSIS_PROGRESS", { message: `已采集 ${payload.items.length} 个商品，正在生成类目分析...` });
    const result = await postAnalysis(payload, apiUrl);
    logStep("extension.analysis_completed", { analysis_id: result.analysis_id || "", items_count: result.items_count || 0 });
    notify(sourceTabId, "CATEGORY_ANALYSIS_RESULT", { result });
  } catch (error) {
    logError("extension.analysis_failed", error, { keyword, source_tab_id: sourceTabId, taobao_tab_id: taobaoTabId });
    notify(sourceTabId, "CATEGORY_ANALYSIS_ERROR", { message: error instanceof Error ? error.message : String(error) });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "START_CATEGORY_ANALYSIS") {
    return false;
  }

  const keyword = String(message.keyword || "").trim();
  const sourceTabId = sender.tab?.id;
  if (!sourceTabId) {
    logStep("extension.start_ignored_missing_source_tab", { keyword });
    return false;
  }
  if (!keyword) {
    logStep("extension.start_rejected_empty_keyword", { source_tab_id: sourceTabId });
    notify(sourceTabId, "CATEGORY_ANALYSIS_ERROR", { message: "请输入类目名称" });
    return false;
  }

  logStep("extension.start_received", { keyword, source_tab_id: sourceTabId });
  runAnalysis(keyword, sourceTabId);
  return false;
});
