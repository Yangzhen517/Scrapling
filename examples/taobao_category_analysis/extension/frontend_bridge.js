function logStep(event, fields = {}) {
  console.info("[taobao-category]", event, {
    at: new Date().toISOString(),
    page_url: window.location.href,
    ...fields
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "taobao-category-page") {
    return;
  }

  if (event.data.type === "START_CATEGORY_ANALYSIS") {
    logStep("bridge.start_forwarded_to_extension", { keyword: event.data.keyword || "" });
    chrome.runtime.sendMessage({
      type: "START_CATEGORY_ANALYSIS",
      keyword: event.data.keyword
    }).catch((error) => {
      logStep("bridge.start_forward_failed", { error: error instanceof Error ? error.message : String(error) });
      window.postMessage({
        source: "taobao-category-extension",
        type: "CATEGORY_ANALYSIS_ERROR",
        message: "Chrome 插件消息发送失败，请刷新扩展和页面后重试。"
      }, window.location.origin);
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type?.startsWith("CATEGORY_ANALYSIS_")) {
    return false;
  }

  logStep("bridge.extension_message_forwarded_to_page", { type: message.type });
  window.postMessage({ source: "taobao-category-extension", ...message }, window.location.origin);
  return false;
});
