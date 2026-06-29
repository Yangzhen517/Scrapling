/**
 * renderers.js — 各 Tab 页面渲染函数
 * 全局命名空间: window.CategoryInsight.renderers
 */
(function (CI) {
  CI.renderers = CI.renderers || {};

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function fmtNum(n) {
    if (n == null) return "-";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万+";
    return n.toLocaleString();
  }

  // === 核心指标卡片 ===
  CI.renderers.metricsCards = function (result) {
    var m = result.metrics || {};
    var price = m.price || {};
    var sales = m.sales || {};
    var shops = m.shops || {};
    var gmv = m.gmv_estimate || {};
    var heat = m.category_heat || {};

    document.getElementById("mcItems").textContent = result.items_count || 0;
    document.getElementById("mcPrice").textContent = price.count || 0;
    document.getElementById("mcSales").textContent = sales.parsed_count || 0;
    document.getElementById("mcShops").textContent = shops.unique_shop_count || 0;
    document.getElementById("mcTotalSales").textContent = gmv.sales_label || "-";
    document.getElementById("mcGmv").textContent = "¥" + (gmv.gmv_label || "-");

    var heatWrap = document.getElementById("mcHeat");
    var info = heatWrap.querySelector(".heat-info");
    info.querySelector(".metric-value").textContent = heat.level || "-";
    info.querySelector(".heat-desc").textContent = heat.description || "";
    var gaugeDom = document.getElementById("heatGauge");
    CI.charts.renderHeatGauge(gaugeDom, heat.score || 0, heat.level || "");
  };

  // === 市场概览 Tab ===
  CI.renderers.market = function (result) {
    var m = result.metrics || {};
    var summary = result.summary || {};
    var report = result.report || {};
    var heat = m.category_heat || {};

    var insights = [];
    if (heat.level) insights.push({ icon: "🔥", title: "市场需求" + heat.level, desc: heat.description || "" });
    var priceBand = (m.price || {}).bands || [];
    var topBand = priceBand.reduce(function (a, b) { return (b.count > (a ? a.count : 0)) ? b : a; }, null);
    if (topBand) insights.push({ icon: "💰", title: "价格带集中在" + topBand.label, desc: "中位价 " + (m.price.median || "-") + " 元" });

    var topContrib = m.top_item_contribution || {};
    var topBands = topContrib.bands || [];
    var top5Band = topBands.find(function (b) { return b.label === "TOP 5"; });
    if (top5Band) insights.push({ icon: "📊", title: "头部商品集中度" + (top5Band.percentage >= 50 ? "较高" : "适中"), desc: "TOP 5 占比 " + top5Band.percentage + "%" });

    var terms = m.title_terms || [];
    var topTerms = terms.slice(0, 3).map(function (t) { return t.term; }).join("、");
    if (topTerms) insights.push({ icon: "🔍", title: "核心卖点关键词", desc: topTerms });

    var insightHtml = insights.map(function (i) {
      return '<div class="insight-item"><span class="insight-icon">' + esc(i.icon) + '</span><div><strong>' + esc(i.title) + '</strong><span>' + esc(i.desc) + '</span></div></div>';
    }).join("");

    return '<div class="grid-3">' +
      '<div class="panel-card"><div class="panel-title">销量分布</div><div id="chartSalesDonut" class="chart-box"></div></div>' +
      '<div class="panel-card"><div class="panel-title">TOP商品销量贡献度</div><div id="chartContribution" class="chart-box"></div></div>' +
      '<div class="ai-card"><div class="panel-title">AI 洞察速览</div><div class="insight-list">' + (insightHtml || '<p style="color:#9ca3af">暂无洞察数据</p>') + '</div></div>' +
    '</div>' +
    '<div class="panel-card"><div class="panel-title">页面排名 vs 销量分布</div><div id="chartRankSales" class="chart-box-sm"></div></div>';
  };

  CI.renderers.marketCharts = function (result) {
    var m = result.metrics || {};
    var sd = document.getElementById("chartSalesDonut");
    if (sd) CI.charts.renderSalesDonut(sd, (m.sales_distribution || {}).bands);
    var cd = document.getElementById("chartContribution");
    if (cd) CI.charts.renderContributionDonut(cd, m.top_item_contribution);
    var rs = document.getElementById("chartRankSales");
    if (rs) CI.charts.renderRankSalesLine(rs, m.rank_sales_distribution);
  };

  // === 价格分析 Tab ===
  CI.renderers.price = function (result) {
    var bands = (result.metrics || {}).price && (result.metrics.price.bands) || [];
    var total = bands.reduce(function (s, b) { return s + b.count; }, 0) || 1;
    var totalSales = bands.reduce(function (s, b) { return s + (b.sales_sum || 0); }, 0) || 1;

    var rows = bands.map(function (b) {
      return '<tr>' +
        '<td>' + esc(b.label) + '</td>' +
        '<td class="num">' + b.count + '</td>' +
        '<td class="num">' + (b.count / total * 100).toFixed(1) + '%</td>' +
        '<td class="num">' + fmtNum(b.sales_sum || 0) + '</td>' +
        '<td class="num">' + (b.sales_percentage || 0).toFixed(1) + '%</td>' +
      '</tr>';
    }).join("");

    return '<div class="panel-card"><div class="panel-title">价格带分析</div><div id="chartPriceBar" class="chart-box-lg"></div></div>' +
      '<div class="panel-card"><table class="data-table"><thead><tr>' +
        '<th>价格段</th><th class="num">商品数</th><th class="num">商品占比</th><th class="num">销量估算</th><th class="num">销量占比</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  };

  CI.renderers.priceCharts = function (result) {
    var bands = (result.metrics || {}).price && result.metrics.price.bands || [];
    var dom = document.getElementById("chartPriceBar");
    if (dom) CI.charts.renderPriceBar(dom, bands);
  };

  // === 竞争格局 Tab ===
  CI.renderers.competition = function (result) {
    var m = result.metrics || {};
    var shops = m.shops || {};
    var topShops = shops.top_shops || [];
    var report = result.report || {};
    var compReport = report.competition_landscape || {};
    var shopCount = shops.unique_shop_count || 0;
    var top5Ratio = shops.top5_concentration_ratio || 0;

    // Concentration calculation for TOP10
    var top10Ratio = 0;
    if (topShops.length > 0) {
      var totalItems = topShops.reduce(function (s, sh) { return s + sh.count; }, 0);
      // Use top5 ratio to estimate top10
      top10Ratio = topShops.slice(0, 10).reduce(function (s, sh) { return s + sh.count; }, 0) / (totalItems || 1);
    }

    var concHtml =
      '<div class="conc-item"><div class="conc-label"><span>TOP 5 店铺占比</span><strong>' + (top5Ratio * 100).toFixed(1) + '%</strong></div>' +
      '<div class="conc-bar"><div class="conc-fill" style="width:' + (top5Ratio * 100) + '%"></div></div></div>' +
      '<div class="conc-item"><div class="conc-label"><span>TOP 10 店铺占比</span><strong>' + (top10Ratio * 100).toFixed(1) + '%</strong></div>' +
      '<div class="conc-bar"><div class="conc-fill" style="width:' + (top10Ratio * 100) + '%"></div></div></div>' +
      '<div class="conc-item"><div class="conc-label"><span>店铺总数</span><strong>' + shopCount + '</strong></div></div>' +
      '<div class="conc-item"><div class="conc-label"><span>集中度评级</span><strong>' + (top5Ratio >= 0.5 ? "偏高" : top5Ratio >= 0.25 ? "中等偏高" : "分散") + '</strong></div></div>';

    var shopRows = topShops.slice(0, 8).map(function (s, i) {
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(s.term) + '</td>' +
        '<td class="num">' + s.count + '</td>' +
        '<td class="num">' + fmtNum(s.sales_sum || 0) + '</td>' +
        '<td class="num">¥' + (s.avg_price || 0) + '</td>' +
      '</tr>';
    }).join("");

    var aiText = compReport.conclusion || (top5Ratio >= 0.5 ? "头部商品集中度高，新进入者需要差异化定位" : "市场竞争相对分散，存在细分切入机会");

    return '<div class="grid-2-1">' +
      '<div class="panel-card"><div class="panel-title">TOP 店铺榜</div><table class="data-table"><thead><tr>' +
        '<th>#</th><th>店铺名称</th><th class="num">商品数</th><th class="num">销量估算</th><th class="num">均价</th>' +
      '</tr></thead><tbody>' + (shopRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af">暂无数据</td></tr>') + '</tbody></table></div>' +
      '<div>' +
        '<div class="panel-card"><div class="panel-title">市场集中度</div>' + concHtml + '</div>' +
        '<div class="ai-card"><div class="panel-title">AI 洞察</div><p style="font-size:13px;color:#6b7280;line-height:1.7">' + esc(aiText) + '</p></div>' +
      '</div>' +
    '</div>';
  };

  // === 需求洞察 Tab ===
  CI.renderers.demand = function (result) {
    var m = result.metrics || {};
    var terms = m.title_terms || [];
    var report = result.report || {};
    var demandReport = report.demand_signals || {};

    var rows = terms.slice(0, 10).map(function (t, i) {
      var typeBadge = t.demand_type ? '<span class="badge badge-blue">' + esc(t.demand_type) + '</span>' : '<span class="badge">其他</span>';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><strong>' + esc(t.term) + '</strong></td>' +
        '<td class="num">' + t.count + '</td>' +
        '<td class="num">' + (t.percentage || 0) + '%</td>' +
        '<td>' + typeBadge + '</td>' +
      '</tr>';
    }).join("");

    var aiText = demandReport.conclusion || "暂无需求洞察";

    return '<div class="grid-2">' +
      '<div class="panel-card"><div class="panel-title">高频词分析</div><div id="chartWordCloud" class="wordcloud-box"></div></div>' +
      '<div class="panel-card"><div class="panel-title">高频词 TOP 10</div><table class="data-table"><thead><tr>' +
        '<th>#</th><th>关键词</th><th class="num">出现次数</th><th class="num">占比</th><th>需求类型</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af">暂无数据</td></tr>') + '</tbody></table></div>' +
    '</div>' +
    '<div class="ai-card"><div class="panel-title">AI 洞察</div><p style="font-size:13px;color:#6b7280;line-height:1.7">' + esc(aiText) + '</p></div>';
  };

  CI.renderers.demandCharts = function (result) {
    var terms = (result.metrics || {}).title_terms || [];
    var dom = document.getElementById("chartWordCloud");
    if (dom) CI.charts.renderWordCloud(dom, terms);
  };

  // === 机会与风险 Tab ===
  CI.renderers.opportunities = function (result) {
    var report = result.report || {};
    var section = report.opportunities_and_risks || {};
    var opps = section.opportunities || [];
    var risks = section.risks || [];

    var oppIcons = ["💎", "✨", "🎯", "📈", "🚀"];
    var oppHtml = opps.map(function (o, i) {
      var title = o.split("：")[0] || o.substring(0, 8);
      var desc = o.split("：").slice(1).join("：") || "";
      return '<div class="opp-item"><span class="opp-icon">' + (oppIcons[i] || "✅") + '</span><div><strong>' + esc(title) + '</strong><span>' + esc(desc) + '</span></div></div>';
    }).join("");

    var riskIcons = ["⚠️", "🔴", "📉", "❗"];
    var riskHtml = risks.map(function (r, i) {
      var title = r.split("：")[0] || r.substring(0, 8);
      var desc = r.split("：").slice(1).join("：") || "";
      return '<div class="risk-item"><span class="risk-icon">' + (riskIcons[i] || "⚠️") + '</span><div><strong>' + esc(title) + '</strong><span>' + esc(desc) + '</span></div></div>';
    }).join("");

    // Action suggestions
    var actionSection = report.action_suggestions || {};
    var actions = actionSection.actions || [];
    var actionHtml = actions.map(function (a) {
      return '<div class="insight-item"><span class="insight-icon">💡</span><div><strong>' + esc(a.title || "建议") + '</strong><span>' + esc(a.detail || "") + '</span></div></div>';
    }).join("");

    return '<div class="grid-2">' +
      '<div class="panel-card"><div class="panel-title" style="color:var(--accent-green)">机会点</div><div class="opp-list">' + (oppHtml || '<p style="color:#9ca3af">暂无</p>') + '</div></div>' +
      '<div class="panel-card"><div class="panel-title" style="color:var(--accent-red)">风险点</div><div class="risk-list">' + (riskHtml || '<p style="color:#9ca3af">暂无</p>') + '</div></div>' +
    '</div>' +
    (actionHtml ? '<div class="ai-card"><div class="panel-title">运营建议</div><div class="insight-list">' + actionHtml + '</div></div>' : '');
  };

  // === 商品列表 Tab ===
  CI.renderers.products = function (result) {
    var products = (result.metrics || {}).top_products || [];
    if (!products.length) return '<p class="placeholder">暂无商品数据</p>';

    var cards = products.map(function (p, i) {
      var imgHtml = p.image_url
        ? '<img class="product-img" src="' + esc(p.image_url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="product-img-placeholder" style="display:none">🖼️</div>'
        : '<div class="product-img-placeholder">🖼️</div>';
      return '<div class="product-card-wrap">' +
        '<span class="product-rank">#' + (i + 1) + '</span>' +
        '<div class="product-card">' + imgHtml +
          '<div class="product-info">' +
            '<div class="product-title">' + esc(p.title) + '</div>' +
            '<div class="product-meta">' +
              '<span class="product-price">¥' + (p.price || "-") + '</span>' +
              '<span class="product-sales">' + esc(p.sales_text || "") + '</span>' +
            '</div>' +
            '<div class="product-shop">' + esc(p.shop_name || "未知店铺") + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("");

    return '<div class="panel-card"><div class="panel-title">TOP 商品榜</div><div class="product-grid">' + cards + '</div></div>';
  };

})(window.CategoryInsight = window.CategoryInsight || {});
