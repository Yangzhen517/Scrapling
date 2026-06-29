/**
 * app.js — 入口文件：事件绑定、Chrome 插件通信、Tab 路由
 */
(function (CI) {
  // === DOM refs ===
  var form = document.getElementById("analysisForm");
  var keywordInput = document.getElementById("keyword");
  var startButton = document.getElementById("startButton");
  var statusBox = document.getElementById("status");
  var tabNav = document.getElementById("tabNav");
  var tabContent = document.getElementById("tabContent");
  var exportBtn = document.getElementById("exportBtn");
  var shareBtn = document.getElementById("shareBtn");

  // === State ===
  var state = {
    currentTab: "market",
    analysisData: null,
    extensionTimeoutId: null,
    activeCharts: [],
  };

  // === Tab chart initializers map ===
  var chartInits = {
    market: CI.renderers.marketCharts,
    price: CI.renderers.priceCharts,
    demand: CI.renderers.demandCharts,
  };

  // === Status helpers ===
  function setStatus(msg, s) {
    statusBox.textContent = msg;
    statusBox.dataset.state = s || "idle";
  }

  function setRunning(running) {
    startButton.disabled = running;
    startButton.textContent = running ? "分析中…" : "开始分析";
  }

  function clearTimeout() {
    if (state.extensionTimeoutId) {
      window.clearTimeout(state.extensionTimeoutId);
      state.extensionTimeoutId = null;
    }
  }

  // === Render active tab ===
  function renderTab(tabName) {
    state.currentTab = tabName;
    var R = CI.renderers;
    var data = state.analysisData;
    var html = "";

    // Dispose all existing charts
    state.activeCharts.forEach(function (c) { try { c.dispose(); } catch (_) {} });
    state.activeCharts = [];

    switch (tabName) {
      case "market":     html = R.market(data); break;
      case "price":      html = R.price(data); break;
      case "competition": html = R.competition(data); break;
      case "demand":     html = R.demand(data); break;
      case "opportunities": html = R.opportunities(data); break;
      case "products":   html = R.products(data); break;
      default: html = '<p class="placeholder">请选择一个分析维度</p>';
    }

    tabContent.innerHTML = html;

    // Initialize charts after DOM is ready
    var initFn = chartInits[tabName];
    if (initFn && data) {
      requestAnimationFrame(function () {
        initFn(data);
        // Collect chart instances for resize/dispose
        var doms = tabContent.querySelectorAll("[id^='chart']");
        doms.forEach(function (dom) {
          var inst = echarts.getInstanceByDom(dom);
          if (inst) state.activeCharts.push(inst);
        });
      });
    }
  }

  // === Render everything after analysis ===
  function renderAll(data) {
    state.analysisData = data;
    CI.renderers.metricsCards(data);
    renderTab(state.currentTab);
  }

  // === Tab navigation ===
  tabNav.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab-btn");
    if (!btn) return;
    tabNav.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    renderTab(btn.dataset.tab);
  });

  // === Form submit → trigger Chrome extension ===
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var keyword = keywordInput.value.trim();
    if (!keyword) {
      setStatus("请输入关键词", "error");
      return;
    }

    setRunning(true);
    setStatus("正在请求插件打开淘宝搜索页…", "running");
    clearTimeout();

    state.extensionTimeoutId = setTimeout(function () {
      setRunning(false);
      setStatus("未检测到 Chrome 插件响应。请确认已安装并启用“淘宝类目分析助手”扩展。", "error");
    }, 15000);

    window.postMessage(
      { source: "taobao-category-page", type: "START_CATEGORY_ANALYSIS", keyword: keyword },
      window.location.origin
    );
  });

  // === Listen for Chrome extension messages ===
  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || event.data.source !== "taobao-category-extension") return;

    if (event.data.type === "CATEGORY_ANALYSIS_PROGRESS") {
      clearTimeout();
      setStatus(event.data.message || "分析进行中…", "running");
    }

    if (event.data.type === "CATEGORY_ANALYSIS_RESULT") {
      clearTimeout();
      var result = event.data.result;
      renderAll(result);
      setStatus("分析完成 — " + keywordInput.value.trim() + " — 分析ID: " + (result.analysis_id || ""), "idle");
      setRunning(false);
    }

    if (event.data.type === "CATEGORY_ANALYSIS_ERROR") {
      clearTimeout();
      setStatus(event.data.message || "分析失败", "error");
      setRunning(false);
    }
  });

  // === Export / Share ===
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      window.print();
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(function () {
          shareBtn.textContent = "已复制";
          setTimeout(function () { shareBtn.textContent = "分享报告"; }, 2000);
        });
      }
    });
  }

  // === Window resize → resize ECharts ===
  window.addEventListener("resize", function () {
    state.activeCharts.forEach(function (c) {
      try { c.resize(); } catch (_) {}
    });
    var gauge = echarts.getInstanceByDom(document.getElementById("heatGauge"));
    if (gauge) gauge.resize();
  });

  // === Initial state ===
  setStatus("插件就绪后，输入关键词点击“开始分析”。");
  tabContent.innerHTML = '<p class="placeholder">完成分析后，这里将展示多维度的类目洞察报告。</p>';

})(window.CategoryInsight = window.CategoryInsight || {});
