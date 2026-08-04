(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIDTH = 680;
  const HEIGHT = 320;
  const MARGIN = { top: 16, right: 16, bottom: 28, left: 64 };
  const COLORS = {
    invested: "#3987e5",
    value: "#199e70",
  };

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) {
      el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  function niceStep(maxValue, tickCount) {
    if (!(maxValue > 0)) return 1;
    const rough = maxValue / tickCount;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / magnitude;
    let niceResidual;
    if (residual > 5) niceResidual = 10;
    else if (residual > 2) niceResidual = 5;
    else if (residual > 1) niceResidual = 2;
    else niceResidual = 1;
    return niceResidual * magnitude;
  }

  function formatCompact(value, currency) {
    const abs = Math.abs(value);
    if (currency === "inr") {
      if (abs >= 1e7) return (value / 1e7).toFixed(1) + " Cr";
      if (abs >= 1e5) return (value / 1e5).toFixed(1) + " L";
      if (abs >= 1e3) return (value / 1e3).toFixed(0) + "K";
      return value.toFixed(0);
    }
    if (abs >= 1e6) return (value / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (value / 1e3).toFixed(1) + "K";
    return value.toFixed(0);
  }

  function legendItem(label, color) {
    const item = document.createElement("div");
    item.className = "chart-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "chart-legend-swatch";
    swatch.style.background = color;
    const text = document.createElement("span");
    text.textContent = label;
    item.appendChild(swatch);
    item.appendChild(text);
    return item;
  }

  function tooltipRow(label, color, valueText) {
    const row = document.createElement("div");
    row.className = "chart-tooltip-row";
    const swatch = document.createElement("span");
    swatch.className = "chart-tooltip-swatch";
    swatch.style.background = color;
    const labelEl = document.createElement("span");
    labelEl.className = "chart-tooltip-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "chart-tooltip-value";
    valueEl.textContent = valueText;
    row.appendChild(swatch);
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  // series: [{date: "YYYY-MM-DD", invested: number, value: number}, ...] ascending by date
  function renderPortfolioChart(rootEl, series, currency, formatMoney) {
    rootEl.textContent = "";
    if (!series || series.length < 2) return;

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.appendChild(legendItem("Invested", COLORS.invested));
    legend.appendChild(legendItem("Portfolio value", COLORS.value));
    rootEl.appendChild(legend);

    const wrap = document.createElement("div");
    wrap.className = "chart-svg-wrap";
    rootEl.appendChild(wrap);

    const svg = svgEl("svg", {
      class: "chart-svg",
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      preserveAspectRatio: "xMidYMid meet",
    });
    wrap.appendChild(svg);

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    wrap.appendChild(tooltip);

    const plotW = WIDTH - MARGIN.left - MARGIN.right;
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const times = series.map((p) => new Date(p.date + "T00:00:00Z").getTime());
    const minT = times[0];
    const maxT = times[times.length - 1];
    const maxValueRaw = series.reduce((m, p) => Math.max(m, p.invested, p.value), 0);
    const yMax = maxValueRaw === 0 ? 1 : maxValueRaw * 1.1;

    function xForIndex(i) {
      if (maxT === minT) return MARGIN.left;
      return MARGIN.left + ((times[i] - minT) / (maxT - minT)) * plotW;
    }
    function yForValue(v) {
      return MARGIN.top + plotH - (v / yMax) * plotH;
    }

    // Gridlines + y-axis labels
    const step = niceStep(yMax, 4);
    let guard = 0;
    for (let v = 0; v <= yMax && guard < 20; v += step, guard++) {
      const y = yForValue(v);
      svg.appendChild(svgEl("line", { class: "chart-gridline", x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y, y2: y }));
      const label = svgEl("text", { class: "chart-axis-text", x: MARGIN.left - 8, y: y + 3, "text-anchor": "end" });
      label.textContent = formatCompact(v, currency);
      svg.appendChild(label);
    }

    // X-axis baseline + date labels
    svg.appendChild(svgEl("line", {
      class: "chart-axis-line",
      x1: MARGIN.left, x2: WIDTH - MARGIN.right,
      y1: HEIGHT - MARGIN.bottom, y2: HEIGHT - MARGIN.bottom,
    }));

    const tickCount = Math.min(5, series.length);
    for (let t = 0; t < tickCount; t++) {
      const idx = Math.round((t / (tickCount - 1 || 1)) * (series.length - 1));
      const x = xForIndex(idx);
      const anchor = t === 0 ? "start" : t === tickCount - 1 ? "end" : "middle";
      const label = svgEl("text", { class: "chart-axis-text", x, y: HEIGHT - MARGIN.bottom + 16, "text-anchor": anchor });
      label.textContent = series[idx].date;
      svg.appendChild(label);
    }

    function buildPath(key) {
      return series.map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(2)} ${yForValue(p[key]).toFixed(2)}`).join(" ");
    }

    svg.appendChild(svgEl("path", {
      d: buildPath("invested"), fill: "none", stroke: COLORS.invested,
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
    svg.appendChild(svgEl("path", {
      d: buildPath("value"), fill: "none", stroke: COLORS.value,
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
    }));

    const ringColor = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#14171c";
    const lastIdx = series.length - 1;
    [["invested", COLORS.invested], ["value", COLORS.value]].forEach(([key, color]) => {
      const cx = xForIndex(lastIdx);
      const cy = yForValue(series[lastIdx][key]);
      svg.appendChild(svgEl("circle", { cx, cy, r: 6, fill: ringColor }));
      svg.appendChild(svgEl("circle", { cx, cy, r: 4, fill: color }));
    });

    const crosshair = svgEl("line", { class: "chart-crosshair", y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, x1: 0, x2: 0 });
    svg.appendChild(crosshair);

    const hoverRect = svgEl("rect", {
      class: "chart-hover-rect",
      x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH,
      fill: "transparent", tabindex: "0",
    });
    svg.appendChild(hoverRect);

    function nearestIndex(mouseX) {
      let lo = 0;
      let hi = series.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xForIndex(mid) < mouseX) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(xForIndex(lo - 1) - mouseX) < Math.abs(xForIndex(lo) - mouseX)) return lo - 1;
      return lo;
    }

    let currentIndex = lastIdx;

    function showAtIndex(idx) {
      currentIndex = Math.max(0, Math.min(lastIdx, idx));
      const point = series[currentIndex];
      const x = xForIndex(currentIndex);

      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.style.opacity = 1;

      tooltip.textContent = "";
      const dateRow = document.createElement("div");
      dateRow.className = "chart-tooltip-date";
      dateRow.textContent = point.date;
      tooltip.appendChild(dateRow);
      tooltip.appendChild(tooltipRow("Invested", COLORS.invested, formatMoney(point.invested, currency)));
      tooltip.appendChild(tooltipRow("Value", COLORS.value, formatMoney(point.value, currency)));
      tooltip.style.opacity = 1;

      const wrapRect = wrap.getBoundingClientRect();
      const pxRatio = wrapRect.width / WIDTH;
      const topValue = Math.max(point.invested, point.value);
      let px = x * pxRatio;
      const py = yForValue(topValue) * (wrapRect.height / HEIGHT);
      const tooltipHalfWidth = 90;
      px = Math.max(tooltipHalfWidth, Math.min(wrapRect.width - tooltipHalfWidth, px));
      tooltip.style.left = px + "px";
      tooltip.style.top = py + "px";
    }

    function hide() {
      crosshair.style.opacity = 0;
      tooltip.style.opacity = 0;
    }

    hoverRect.addEventListener("pointermove", (evt) => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((evt.clientX - rect.left) / rect.width) * WIDTH;
      showAtIndex(nearestIndex(mouseX));
    });
    hoverRect.addEventListener("pointerleave", hide);
    hoverRect.addEventListener("focus", () => showAtIndex(lastIdx));
    hoverRect.addEventListener("blur", hide);
    hoverRect.addEventListener("keydown", (evt) => {
      if (evt.key === "ArrowLeft") {
        showAtIndex(currentIndex - 1);
        evt.preventDefault();
      } else if (evt.key === "ArrowRight") {
        showAtIndex(currentIndex + 1);
        evt.preventDefault();
      }
    });
  }

  window.renderPortfolioChart = renderPortfolioChart;
})();
