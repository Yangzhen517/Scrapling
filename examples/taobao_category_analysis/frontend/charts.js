/**
 * charts.js — ECharts 图表封装模块
 * 全局命名空间: window.CategoryInsight.charts
 */
(function (CI) {
  CI.charts = CI.charts || {};

  var PALETTE = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  function initChart(dom) {
    if (!dom) return null;
    var existing = echarts.getInstanceByDom(dom);
    if (existing) existing.dispose();
    return echarts.init(dom);
  }

  /**
   * 销量分布环形图
   * @param {HTMLElement} dom
   * @param {Array} bands - [{label, count, percentage}, ...]
   */
  CI.charts.renderSalesDonut = function (dom, bands) {
    var chart = initChart(dom);
    if (!chart || !bands || !bands.length) return;
    var data = bands.map(function (b) {
      return { name: b.label, value: b.count };
    });
    chart.setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} 个商品 ({d}%)" },
      legend: { bottom: 0, textStyle: { fontSize: 11, color: "#6b7280" } },
      color: PALETTE,
      series: [{
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 13, fontWeight: "bold", formatter: "{b}\n{d}%" }
        },
        data: data
      }]
    });
    return chart;
  };

  /**
   * TOP商品销量贡献度环形图
   * @param {HTMLElement} dom
   * @param {Object} data - {bands: [{label, sales_sum, percentage}], total_sales}
   */
  CI.charts.renderContributionDonut = function (dom, data) {
    var chart = initChart(dom);
    if (!chart || !data || !data.bands) return;
    var topBand = data.bands.find(function (b) { return b.label === "TOP 5"; }) || data.bands[0];
    var seriesData = data.bands.filter(function (b) { return b.sales_sum > 0; }).map(function (b) {
      return { name: b.label, value: b.sales_sum };
    });
    chart.setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { fontSize: 11, color: "#6b7280" } },
      color: PALETTE,
      graphic: [{
        type: "text",
        left: "center",
        top: "38%",
        style: {
          text: topBand ? (topBand.percentage + "%") : "",
          textAlign: "center",
          fill: "#6366f1",
          fontSize: 22,
          fontWeight: "bold",
          fontFamily: "-apple-system, sans-serif"
        }
      }, {
        type: "text",
        left: "center",
        top: "48%",
        style: {
          text: "TOP 5 占比",
          textAlign: "center",
          fill: "#9ca3af",
          fontSize: 11,
          fontFamily: "-apple-system, sans-serif"
        }
      }],
      series: [{
        type: "pie",
        radius: ["50%", "72%"],
        center: ["50%", "44%"],
        label: { show: false },
        data: seriesData
      }]
    });
    return chart;
  };

  /**
   * 类目热度仪表盘
   * @param {HTMLElement} dom
   * @param {number} score 0-100
   * @param {string} level "高"/"中高"/"中"/"中低"/"低"
   */
  CI.charts.renderHeatGauge = function (dom, score, level) {
    var chart = initChart(dom);
    if (!chart) return;
    var color = score >= 80 ? "#ef4444" : score >= 60 ? "#f59e0b" : score >= 40 ? "#3b82f6" : score >= 20 ? "#6b7280" : "#9ca3af";
    chart.setOption({
      series: [{
        type: "gauge",
        startAngle: 180,
        endAngle: 0,
        radius: "92%",
        center: ["50%", "78%"],
        min: 0,
        max: 100,
        progress: { show: true, width: 10, roundCap: true },
        axisLine: { lineStyle: { width: 10, color: [[1, "#e5e7eb"]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 20,
          fontWeight: "bold",
          color: color,
          offsetCenter: [0, "5%"],
          formatter: "{value}"
        },
        pointer: { show: false },
        data: [{ value: score }],
        itemStyle: { color: color }
      }]
    });
    return chart;
  };

  /**
   * 价格带柱状图（双系列：商品数占比 vs 销量占比）
   * @param {HTMLElement} dom
   * @param {Array} bands - [{label, count, sales_percentage, sales_count}]
   */
  CI.charts.renderPriceBar = function (dom, bands) {
    var chart = initChart(dom);
    if (!chart || !bands || !bands.length) return;
    var total = bands.reduce(function (sum, b) { return sum + b.count; }, 0) || 1;
    var labels = bands.map(function (b) { return b.label; });
    var countPcts = bands.map(function (b) { return +(b.count / total * 100).toFixed(1); });
    var salesPcts = bands.map(function (b) { return b.sales_percentage || 0; });
    chart.setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (params) {
        return params.map(function (p) { return p.marker + p.seriesName + ": " + p.value + "%"; }).join("<br>");
      }},
      legend: { bottom: 0, textStyle: { fontSize: 11, color: "#6b7280" } },
      grid: { left: 40, right: 16, top: 12, bottom: 50 },
      xAxis: { type: "category", data: labels, axisLabel: { fontSize: 11, color: "#6b7280" }, axisLine: { lineStyle: { color: "#e5e7eb" } } },
      yAxis: { type: "value", axisLabel: { fontSize: 11, color: "#9ca3af", formatter: "{value}%" }, splitLine: { lineStyle: { color: "#f0f0f5" } }, axisLine: { show: false } },
      color: ["#6366f1", "#a5b4fc"],
      series: [
        { name: "商品数占比", type: "bar", data: countPcts, barGap: "10%", barMaxWidth: 32, itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "销量占比", type: "bar", data: salesPcts, barMaxWidth: 32, itemStyle: { borderRadius: [4, 4, 0, 0] } }
      ]
    });
    return chart;
  };

  /**
   * Rank-Sales 分布图
   * @param {HTMLElement} dom
   * @param {Array} data - [{rank, title, sales_value, price_value}]
   */
  CI.charts.renderRankSalesLine = function (dom, data) {
    var chart = initChart(dom);
    if (!chart || !data || !data.length) return;
    var seriesData = data.map(function (d) { return [d.rank, d.sales_value]; });
    chart.setOption({
      tooltip: {
        trigger: "item",
        formatter: function (p) {
          var d = data[p.dataIndex];
          return "排名 #" + d.rank + "<br>" + (d.title || "") + "<br>销量: " + (d.sales_value || 0) + "<br>价格: ¥" + (d.price_value || "-");
        }
      },
      grid: { left: 50, right: 16, top: 12, bottom: 36 },
      xAxis: { type: "value", name: "页面排名", nameTextStyle: { fontSize: 11, color: "#9ca3af" }, axisLabel: { fontSize: 11, color: "#9ca3af" }, splitLine: { lineStyle: { color: "#f0f0f5" } } },
      yAxis: { type: "value", name: "销量", nameTextStyle: { fontSize: 11, color: "#9ca3af" }, axisLabel: { fontSize: 11, color: "#9ca3af", formatter: function (v) { return v >= 10000 ? (v/10000) + "万" : v; } }, splitLine: { lineStyle: { color: "#f0f0f5" } }, axisLine: { show: false } },
      color: ["#6366f1"],
      series: [{
        type: "scatter",
        data: seriesData,
        symbolSize: function (val) { return Math.max(8, Math.min(20, val[1] / 1000)); },
        emphasis: { itemStyle: { borderColor: "#6366f1", borderWidth: 2 } }
      }]
    });
    return chart;
  };

  /**
   * 词云
   * @param {HTMLElement} dom
   * @param {Array} terms - [{term, count, percentage, demand_type}]
   */
  CI.charts.renderWordCloud = function (dom, terms) {
    if (!dom || !terms || !terms.length) return;
    var chart = initChart(dom);
    if (!chart) return;
    var maxCount = Math.max.apply(null, terms.map(function (t) { return t.count; }));
    var cloudData = terms.map(function (t) {
      return { name: t.term, value: t.count };
    });
    try {
      chart.setOption({
        tooltip: { formatter: function (p) { return p.name + ": " + p.value + "次"; } },
        series: [{
          type: "wordCloud",
          shape: "circle",
          left: "center",
          top: "center",
          width: "90%",
          height: "90%",
          sizeRange: [12, 56],
          rotationRange: [-30, 30],
          rotationStep: 15,
          gridSize: 12,
          drawOutOfBound: false,
          textStyle: {
            fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
            fontWeight: "bold",
            color: function () {
              var colors = ["#6366f1", "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];
              return colors[Math.floor(Math.random() * colors.length)];
            }
          },
          data: cloudData
        }]
      });
    } catch (e) {
      /* echarts-wordcloud 未加载时静默 */
    }
    return chart;
  };

})(window.CategoryInsight = window.CategoryInsight || {});
