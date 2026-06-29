function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function logStep(event, fields = {}) {
  console.info("[taobao-category]", event, {
    at: new Date().toISOString(),
    page_url: window.location.href,
    ...fields
  });
}

function logError(event, error, fields = {}) {
  console.error("[taobao-category]", event, {
    at: new Date().toISOString(),
    page_url: window.location.href,
    error: error instanceof Error ? error.message : String(error),
    ...fields
  });
}

function absoluteUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value, window.location.href);
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function isProductUrl(value) {
  const url = absoluteUrl(value);
  return /(?:item\.taobao\.com|detail\.tmall\.com)\/item\.htm/i.test(url) || /[?&]id=\d+/i.test(url);
}

function getKeyword() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("q") || params.get("keyword") || params.get("query");
  if (fromUrl) {
    const keyword = normalizeText(decodeURIComponent(fromUrl));
    logStep("content.keyword_detected", { source: "url", keyword });
    return keyword;
  }

  const input = document.querySelector('input[name="q"], input[name="keyword"], input[placeholder*="搜索"], #q');
  if (input && input.value) {
    const keyword = normalizeText(input.value);
    logStep("content.keyword_detected", { source: "input", keyword });
    return keyword;
  }

  const keyword = normalizeText(document.title.replace(/[-_].*$/, ""));
  logStep("content.keyword_detected", { source: "title", keyword });
  return keyword;
}

function findProductContainers() {
  const anchors = Array.from(document.querySelectorAll("a[href]")).filter((anchor) => isProductUrl(anchor.href));
  const containers = new Set();
  logStep("content.product_anchor_scan_finished", { anchors_count: anchors.length });

  for (const anchor of anchors) {
    let node = anchor;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      const text = normalizeText(node.innerText || node.textContent);
      const hasImage = Boolean(node.querySelector && node.querySelector("img"));
      const hasPrice = /[¥￥]\s*\d|\d+(?:\.\d+)?\s*元/.test(text);
      if (node !== anchor && hasImage && hasPrice && text.length >= 10) {
        containers.add(node);
        break;
      }
      node = node.parentElement;
    }
  }

  const result = Array.from(containers);
  logStep("content.product_container_scan_finished", { containers_count: result.length });
  return result;
}

function pickTitle(container) {
  const selectors = [
    '[class*="title"]',
    '[class*="Title"]',
    '[class*="name"]',
    '[class*="Name"]',
    "a[title]",
    "a"
  ];

  for (const selector of selectors) {
    const candidates = Array.from(container.querySelectorAll(selector));
    for (const candidate of candidates) {
      const text = normalizeText(candidate.getAttribute("title") || candidate.getAttribute("aria-label") || candidate.innerText || candidate.textContent);
      if (text.length >= 4 && !/[¥￥]\s*\d/.test(text)) {
        return text;
      }
    }
  }

  const image = container.querySelector("img[alt]");
  return image ? normalizeText(image.alt) : "";
}

function pickPrice(container) {
  const text = normalizeText(container.innerText || container.textContent);
  const match = text.match(/[¥￥]\s*\d+(?:\.\d+)?(?:\s*[-~]\s*[¥￥]?\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s*元/);
  return match ? normalizeText(match[0]) : "";
}

function pickSalesText(container) {
  const text = normalizeText(container.innerText || container.textContent);
  const match = text.match(/(?:月销|销量|已售)?\s*\d+(?:\.\d+)?\s*万?\s*\+?\s*(?:人付款|付款|人收货|人已买|件已售|已售|月销|销量)/);
  return match ? normalizeText(match[0]) : "";
}

function pickShopName(container) {
  const selectors = [
    '[class*="shop"]',
    '[class*="Shop"]',
    '[class*="seller"]',
    '[class*="Seller"]',
    '[class*="nick"]',
    'a[href*="shop"]'
  ];

  for (const selector of selectors) {
    const candidates = Array.from(container.querySelectorAll(selector));
    for (const candidate of candidates) {
      const text = normalizeText(candidate.innerText || candidate.textContent || candidate.getAttribute("title"));
      if (text && text.length <= 40 && !/[¥￥]\s*\d/.test(text)) {
        return text;
      }
    }
  }

  return "";
}

function pickItemUrl(container) {
  const anchor = Array.from(container.querySelectorAll("a[href]")).find((candidate) => isProductUrl(candidate.href));
  return anchor ? absoluteUrl(anchor.href) : "";
}

function pickImageUrl(container) {
  const image = container.querySelector("img");
  if (!image) {
    return "";
  }
  return absoluteUrl(image.currentSrc || image.src || image.getAttribute("data-src") || image.getAttribute("data-ks-lazyload"));
}

function collectTaobaoPage() {
  const startedAt = Date.now();
  logStep("content.collect_started");
  const pageText = normalizeText(document.body?.innerText || "");
  if (/验证码|安全验证|登录后查看|请登录/.test(pageText)) {
    logStep("content.collect_blocked_by_login_or_security");
    throw new Error("淘宝页面需要登录或安全验证，请手动处理后重试。");
  }

  const containers = findProductContainers();
  const seen = new Set();
  const items = [];
  const skipped = {
    missing_url: 0,
    missing_title: 0,
    missing_price: 0,
    duplicate_url: 0
  };

  for (const container of containers) {
    const itemUrl = pickItemUrl(container);
    const title = pickTitle(container);
    const price = pickPrice(container);
    if (!itemUrl) {
      skipped.missing_url += 1;
      continue;
    }
    if (!title) {
      skipped.missing_title += 1;
      continue;
    }
    if (!price) {
      skipped.missing_price += 1;
      continue;
    }
    if (seen.has(itemUrl)) {
      skipped.duplicate_url += 1;
      continue;
    }

    seen.add(itemUrl);
    items.push({
      title,
      price,
      sales_text: pickSalesText(container),
      shop_name: pickShopName(container),
      item_url: itemUrl,
      image_url: pickImageUrl(container),
      rank: items.length + 1
    });
  }

  const payload = {
    keyword: getKeyword(),
    source_url: window.location.href,
    captured_at: new Date().toISOString(),
    items
  };
  logStep("content.collect_finished", {
    containers_count: containers.length,
    items_count: items.length,
    skipped,
    duration_ms: Date.now() - startedAt
  });
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "COLLECT_TAOBAO_PAGE") {
    return false;
  }

  try {
    logStep("content.message_received", { type: message.type });
    sendResponse({ ok: true, payload: collectTaobaoPage() });
    logStep("content.message_responded", { type: message.type, ok: true });
  } catch (error) {
    logError("content.message_failed", error, { type: message.type });
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return true;
});
