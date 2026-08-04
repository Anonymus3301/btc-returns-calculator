(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIDTH = 680;
  const HEIGHT = 320;
  const MARGIN = { top: 16, right: 16, bottom: 28, left: 64 };
  const COLORS = {
    invested: "#3987e5",
    value: "#199e70",
    fd: "#c98500",
  };
  const LABELS = {
    invested: "Invested",
    value: "Portfolio value",
    fd: "Fixed Deposit",
  };

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) {
      el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  function chartTheme() {
    const cs = getComputedStyle(document.documentElement);
    return {
      surface: cs.getPropertyValue("--card").trim() || "#14171c",
      muted: cs.getPropertyValue("--muted").trim() || "#8b93a1",
      border: cs.getPropertyValue("--border").trim() || "#262b33",
      text: cs.getPropertyValue("--text").trim() || "#e9edf1",
    };
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

  function activeKeys(series) {
    const keys = ["invested", "value"];
    if (series[0].fd != null) keys.push("fd");
    return keys;
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

  // Builds the plot's static geometry (gridlines, axes, lines, end dots) as
  // pure SVG with presentation attributes — no CSS classes for anything
  // that needs to survive being serialized and rendered standalone (PNG
  // export). Returns { svg, xForIndex, yForValue, keys }.
  function buildStaticChart(series, currency, theme) {
    const keys = activeKeys(series);
    const svg = svgEl("svg", {
      class: "chart-svg",
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      preserveAspectRatio: "xMidYMid meet",
    });

    const plotW = WIDTH - MARGIN.left - MARGIN.right;
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const times = series.map((p) => new Date(p.date + "T00:00:00Z").getTime());
    const minT = times[0];
    const maxT = times[times.length - 1];
    const maxValueRaw = series.reduce((m, p) => Math.max(m, ...keys.map((k) => p[k])), 0);
    const yMax = maxValueRaw === 0 ? 1 : maxValueRaw * 1.1;

    function xForIndex(i) {
      if (maxT === minT) return MARGIN.left;
      return MARGIN.left + ((times[i] - minT) / (maxT - minT)) * plotW;
    }
    function yForValue(v) {
      return MARGIN.top + plotH - (v / yMax) * plotH;
    }

    const step = niceStep(yMax, 4);
    let guard = 0;
    for (let v = 0; v <= yMax && guard < 20; v += step, guard++) {
      const y = yForValue(v);
      svg.appendChild(svgEl("line", {
        x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y, y2: y,
        stroke: theme.border, "stroke-width": 1,
      }));
      const label = svgEl("text", {
        x: MARGIN.left - 8, y: y + 3, "text-anchor": "end",
        fill: theme.muted, "font-size": 10,
      });
      label.textContent = formatCompact(v, currency);
      svg.appendChild(label);
    }

    svg.appendChild(svgEl("line", {
      x1: MARGIN.left, x2: WIDTH - MARGIN.right,
      y1: HEIGHT - MARGIN.bottom, y2: HEIGHT - MARGIN.bottom,
      stroke: theme.muted, "stroke-width": 1,
    }));

    const tickCount = Math.min(5, series.length);
    for (let t = 0; t < tickCount; t++) {
      const idx = Math.round((t / (tickCount - 1 || 1)) * (series.length - 1));
      const x = xForIndex(idx);
      const anchor = t === 0 ? "start" : t === tickCount - 1 ? "end" : "middle";
      const label = svgEl("text", {
        x, y: HEIGHT - MARGIN.bottom + 16, "text-anchor": anchor,
        fill: theme.muted, "font-size": 10,
      });
      label.textContent = series[idx].date;
      svg.appendChild(label);
    }

    function buildPath(key) {
      return series.map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(2)} ${yForValue(p[key]).toFixed(2)}`).join(" ");
    }

    keys.forEach((key) => {
      svg.appendChild(svgEl("path", {
        d: buildPath(key), fill: "none", stroke: COLORS[key],
        "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
    });

    const lastIdx = series.length - 1;
    keys.forEach((key) => {
      const cx = xForIndex(lastIdx);
      const cy = yForValue(series[lastIdx][key]);
      svg.appendChild(svgEl("circle", { cx, cy, r: 6, fill: theme.surface }));
      svg.appendChild(svgEl("circle", { cx, cy, r: 4, fill: COLORS[key] }));
    });

    return { svg, xForIndex, yForValue, keys, plotW, plotH };
  }

  // series: [{date: "YYYY-MM-DD", invested, value, fd?}, ...] ascending by date
  function renderPortfolioChart(rootEl, series, currency, formatMoney) {
    rootEl.textContent = "";
    if (!series || series.length < 2) return;

    const theme = chartTheme();
    const keys = activeKeys(series);

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    keys.forEach((key) => legend.appendChild(legendItem(LABELS[key], COLORS[key])));
    rootEl.appendChild(legend);

    const wrap = document.createElement("div");
    wrap.className = "chart-svg-wrap";
    rootEl.appendChild(wrap);

    const { svg, xForIndex, yForValue, plotW, plotH } = buildStaticChart(series, currency, theme);
    wrap.appendChild(svg);

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    wrap.appendChild(tooltip);

    const crosshair = svgEl("line", { class: "chart-crosshair", y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, x1: 0, x2: 0 });
    svg.appendChild(crosshair);

    const hoverRect = svgEl("rect", {
      class: "chart-hover-rect",
      x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH,
      fill: "transparent", tabindex: "0",
    });
    svg.appendChild(hoverRect);

    const lastIdx = series.length - 1;

    function nearestIndex(mouseX) {
      let lo = 0;
      let hi = lastIdx;
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
      keys.forEach((key) => {
        tooltip.appendChild(tooltipRow(LABELS[key], COLORS[key], formatMoney(point[key], currency)));
      });
      tooltip.style.opacity = 1;

      const wrapRect = wrap.getBoundingClientRect();
      const pxRatio = wrapRect.width / WIDTH;
      const topValue = Math.max(...keys.map((k) => point[k]));
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

    rootEl._chartSeries = series;
    rootEl._chartCurrency = currency;
  }

  // Rebuilds a self-contained export SVG (title + in-SVG legend + the same
  // static geometry) so the PNG doesn't depend on the page's stylesheet,
  // then rasterizes it via canvas and triggers a download.
  function exportChartPng(rootEl, filename) {
    const series = rootEl._chartSeries;
    const currency = rootEl._chartCurrency;
    if (!series) return;

    const theme = chartTheme();
    const keys = activeKeys(series);
    const TOP_PAD = 44; // room for title + legend
    const exportWidth = WIDTH;
    const exportHeight = HEIGHT + TOP_PAD;

    const svg = svgEl("svg", {
      xmlns: SVG_NS,
      width: exportWidth,
      height: exportHeight,
      viewBox: `0 0 ${exportWidth} ${exportHeight}`,
    });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: exportWidth, height: exportHeight, fill: theme.surface }));

    const title = svgEl("text", { x: 16, y: 20, "font-size": 13, "font-weight": 700, fill: theme.text });
    title.textContent = "Portfolio value over time";
    svg.appendChild(title);

    keys.forEach((key, i) => {
      const lx = 16 + i * 150;
      svg.appendChild(svgEl("line", { x1: lx, x2: lx + 14, y1: 36, y2: 36, stroke: COLORS[key], "stroke-width": 2 }));
      const label = svgEl("text", { x: lx + 20, y: 40, "font-size": 11, fill: theme.text });
      label.textContent = LABELS[key];
      svg.appendChild(label);
    });

    const { svg: plot } = buildStaticChart(series, currency, theme);
    const plotGroup = svgEl("g", { transform: `translate(0, ${TOP_PAD})` });
    while (plot.firstChild) plotGroup.appendChild(plot.firstChild);
    svg.appendChild(plotGroup);

    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = exportWidth * scale;
      canvas.height = exportHeight * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, exportWidth, exportHeight);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = filename || "chart.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  window.renderPortfolioChart = renderPortfolioChart;
  window.exportChartPng = exportChartPng;
})();
