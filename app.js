(() => {
  const LOG_PREFIX = "[btc-calc]";
  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function logError(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  const API_BASE = "https://www.zebapi.com/api/v2/market";
  const SYMBOLS = { inr: "BTC-INR", usdt: "BTC-USDT" };
  const START_DATE_SEC = Date.UTC(2020, 2, 10) / 1000; // 2020-03-10 UTC
  const CACHE_PREFIX = "btc-klines-v3-";
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  const DAY_SEC = 24 * 60 * 60;
  const MAX_CANDLES_PER_PAGE = 1000; // API caps each response at 1000 candles
  const MAX_PAGES = 20; // safety cap against runaway pagination loops

  const statusEl = document.getElementById("status");
  const formEl = document.getElementById("calc-form");
  const dateEl = document.getElementById("date");
  const dateLabelEl = document.getElementById("date-label");
  const dateHintEl = document.getElementById("date-hint");
  const amountEl = document.getElementById("amount");
  const amountLabelEl = document.getElementById("amount-label");
  const currencyEl = document.getElementById("currency");
  const usdtOptionEl = document.getElementById("usdt-option");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");
  const investTypeRadios = document.querySelectorAll('input[name="invest-type"]');
  const buyPriceLabelEl = document.getElementById("res-buy-price-label");
  const totalInvestedItemEl = document.getElementById("res-total-invested-item");
  const installmentsItemEl = document.getElementById("res-installments-item");
  const chartSectionEl = document.getElementById("chart-section");
  const chartRootEl = document.getElementById("chart-root");
  const stepupFieldEl = document.getElementById("stepup-field");
  const stepupEl = document.getElementById("stepup");
  const fdToggleEl = document.getElementById("fd-toggle");
  const fdRateFieldEl = document.getElementById("fd-rate-field");
  const fdRateEl = document.getElementById("fd-rate");
  const fdItemEl = document.getElementById("res-fd-item");
  const copyLinkBtn = document.getElementById("copy-link-btn");
  const exportCsvBtn = document.getElementById("export-csv-btn");
  const exportPngBtn = document.getElementById("export-png-btn");

  // currency -> Map(dateStr -> closingPrice)
  let priceHistory = { inr: new Map(), usdt: new Map() };
  let sortedDates = { inr: [], usdt: [] };
  let currentPrices = { inr: null, usdt: null };

  function toDateStr(tsMs) {
    return new Date(tsMs).toISOString().slice(0, 10);
  }

  function buildMap(klines) {
    const map = new Map();
    for (const k of klines) {
      const [openTimeSec, , , , close] = k;
      map.set(toDateStr(openTimeSec * 1000), parseFloat(close));
    }
    return map;
  }

  function formatMoney(value, currency) {
    if (currency === "inr") {
      return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    }
    return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function formatBtc(qty) {
    return qty.toLocaleString("en-US", { maximumFractionDigits: 8 }) + " BTC";
  }

  // Fetches one page of daily candles. The API only returns data for
  // day-aligned (UTC midnight) start/end timestamps (a non-aligned range
  // silently returns an empty array), and caps each response at
  // MAX_CANDLES_PER_PAGE candles regardless of the requested range.
  async function fetchKlinesPage(symbol, startSec, endSec) {
    const url = `${API_BASE}/klines?symbol=${symbol}&interval=1d&startTime=${startSec}&endTime=${endSec}`;
    log(`${symbol}: fetching page`, url);

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      logError(`${symbol}: fetch() threw (network/CORS error)`, e);
      throw new Error(`Network error contacting price API: ${e.message}`);
    }

    log(`${symbol}: response status`, res.status, res.statusText);
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Rate limited. Please wait a moment and try again.");
      }
      throw new Error(`Request failed (${res.status})`);
    }

    const rawText = await res.text();
    log(`${symbol}: raw response length`, rawText.length, "first 300 chars:", rawText.slice(0, 300));

    let body;
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      logError(`${symbol}: response was not valid JSON`, e);
      throw new Error("Price API returned invalid JSON.");
    }

    const klines = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(klines)) {
      logError(`${symbol}: unexpected response shape`, body);
      throw new Error("Price API returned an unexpected response shape.");
    }
    log(`${symbol}: page returned ${klines.length} candles`);
    return klines;
  }

  async function fetchKlines(symbol) {
    const cacheKey = CACHE_PREFIX + symbol;
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        const ageMs = Date.now() - cached.fetchedAt;
        if (
          Array.isArray(cached.klines) &&
          cached.klines.length > 0 &&
          ageMs < CACHE_TTL_MS
        ) {
          log(`${symbol}: using cached data, ${cached.klines.length} candles, age ${Math.round(ageMs / 1000)}s`);
          return cached.klines;
        }
        log(`${symbol}: cache present but stale/invalid (length=${cached.klines && cached.klines.length}, age=${Math.round(ageMs / 1000)}s), refetching`);
      } catch (e) {
        log(`${symbol}: corrupt cache entry, ignoring`, e);
      }
    } else {
      log(`${symbol}: no cache entry, fetching fresh`);
    }

    const todayMidnightSec = Math.floor(Date.now() / (DAY_SEC * 1000)) * DAY_SEC;
    const overallEndSec = todayMidnightSec + DAY_SEC;

    let cursor = START_DATE_SEC;
    let allKlines = [];
    let pages = 0;

    while (cursor < overallEndSec && pages < MAX_PAGES) {
      pages++;
      const pageEndSec = Math.min(cursor + (MAX_CANDLES_PER_PAGE - 1) * DAY_SEC, overallEndSec);
      const page = await fetchKlinesPage(symbol, cursor, pageEndSec);
      if (page.length === 0) {
        log(`${symbol}: empty page at cursor ${cursor}, stopping pagination`);
        break;
      }
      allKlines = allKlines.concat(page);

      const lastOpenTimeSec = page[page.length - 1][0];
      const nextCursor = lastOpenTimeSec + DAY_SEC;
      if (nextCursor <= cursor) {
        log(`${symbol}: pagination cursor didn't advance, stopping to avoid an infinite loop`);
        break;
      }
      cursor = nextCursor;
    }

    log(`${symbol}: pagination done, ${pages} page(s), ${allKlines.length} total candles`);

    if (allKlines.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), klines: allKlines }));
        log(`${symbol}: cached ${allKlines.length} candles`);
      } catch (e) {
        log(`${symbol}: failed to write cache`, e);
      }
    }

    return allKlines;
  }

  function findPriceForDate(currency, dateStr) {
    const map = priceHistory[currency];
    if (map.has(dateStr)) {
      return { price: map.get(dateStr), actualDate: dateStr };
    }
    // fall back to the closest earlier available date
    let fallback = null;
    for (const d of sortedDates[currency]) {
      if (d <= dateStr) fallback = d;
      else break;
    }
    if (fallback) {
      return { price: map.get(fallback), actualDate: fallback };
    }
    return null;
  }

  function getInvestType() {
    for (const radio of investTypeRadios) {
      if (radio.checked) return radio.value;
    }
    return "lumpsum";
  }

  function updateFormForType() {
    const isSip = getInvestType() === "sip";
    dateLabelEl.textContent = isSip ? "SIP start date" : "Investment date";
    amountLabelEl.textContent = isSip ? "Amount per month" : "Amount invested";
    stepupFieldEl.classList.toggle("hidden", !isSip);
  }

  investTypeRadios.forEach((radio) => radio.addEventListener("change", updateFormForType));

  fdToggleEl.addEventListener("change", () => {
    fdRateFieldEl.classList.toggle("hidden", !fdToggleEl.checked);
  });

  function addMonth(date) {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  // Bisection solver for the annualized rate that makes the NPV of a list
  // of {date: Date, amount: number} cashflows (outflows negative, inflows
  // positive) equal zero. Robust for the outflows-then-one-inflow shape an
  // investment always has (NPV(rate) is monotonic, so bisection can't
  // diverge the way Newton-Raphson sometimes does). Returns a decimal rate
  // (0.18 = 18%), or null if no root is bracketed.
  function computeXIRR(cashflows) {
    const t0 = cashflows[0].date.getTime();
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    function npv(rate) {
      return cashflows.reduce((sum, cf) => {
        const years = (cf.date.getTime() - t0) / YEAR_MS;
        return sum + cf.amount / Math.pow(1 + rate, years);
      }, 0);
    }

    let lo = -0.9999;
    let hi = 100;
    let npvLo = npv(lo);
    let npvHi = npv(hi);
    if (!isFinite(npvLo) || !isFinite(npvHi) || npvLo * npvHi > 0) {
      return null;
    }
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const npvMid = npv(mid);
      if (Math.abs(npvMid) < 1e-6) return mid;
      if ((npvLo < 0) === (npvMid < 0)) {
        lo = mid;
        npvLo = npvMid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }

  function formatPercent(rate) {
    if (rate === null || !isFinite(rate)) return "N/A";
    const sign = rate >= 0 ? "+" : "-";
    return `${sign}${Math.abs(rate * 100).toFixed(2)}% p.a.`;
  }

  // Walks the monthly SIP schedule and resolves each installment to the
  // real trading date whose price it actually buys at (via the same
  // nearest-prior-date fallback as everything else), applying the step-up
  // every 12 installments. Shared by calculateSip() and buildTimeSeries()
  // so the two can never disagree about which dates/amounts were invested.
  function computeSipInstallments(startDateStr, initialAmount, currency, stepUpPercent) {
    const maxDateStr = dateEl.max;
    let cursor = new Date(startDateStr + "T00:00:00Z");
    const maxDate = new Date(maxDateStr + "T00:00:00Z");
    const installments = [];
    let currentAmount = initialAmount;
    let i = 0;

    while (cursor <= maxDate) {
      if (i > 0 && i % 12 === 0 && stepUpPercent) {
        currentAmount = currentAmount * (1 + stepUpPercent / 100);
      }
      const found = findPriceForDate(currency, cursor.toISOString().slice(0, 10));
      if (found) {
        installments.push({ date: found.actualDate, amount: currentAmount, price: found.price });
      }
      i++;
      cursor = addMonth(cursor);
    }

    return installments;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function clearError() {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  async function loadCurrency(currency) {
    log(`loadCurrency(${currency}): start`);
    const klines = await fetchKlines(SYMBOLS[currency]);
    if (!Array.isArray(klines) || klines.length === 0) {
      logError(`loadCurrency(${currency}): no usable klines`, klines);
      throw new Error("No data returned.");
    }
    priceHistory[currency] = buildMap(klines);
    sortedDates[currency] = [...priceHistory[currency].keys()].sort();
    const maxDate = sortedDates[currency][sortedDates[currency].length - 1];
    currentPrices[currency] = priceHistory[currency].get(maxDate);
    log(`loadCurrency(${currency}): done`, {
      days: sortedDates[currency].length,
      minDate: sortedDates[currency][0],
      maxDate,
      currentPrice: currentPrices[currency],
    });
  }

  // Total FD-equivalent value, as of asOfDateStr, of a list of deposit
  // events compounding annually at fdRatePercent from each deposit's own date.
  function computeFdValue(events, fdRatePercent, asOfDateStr) {
    const asOf = new Date(asOfDateStr + "T00:00:00Z").getTime();
    const rate = fdRatePercent / 100;
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    return events.reduce((sum, e) => {
      const t = new Date(e.date + "T00:00:00Z").getTime();
      const years = Math.max((asOf - t) / YEAR_MS, 0);
      return sum + e.amount * Math.pow(1 + rate, years);
    }, 0);
  }

  function calculate(dateStr, amount, currency, fdRatePercent) {
    const found = findPriceForDate(currency, dateStr);
    if (!found) {
      throw new Error("No price data available for that date.");
    }

    const buyPrice = found.price;
    const currentPrice = currentPrices[currency];
    const btcQty = amount / buyPrice;
    const currentValue = btcQty * currentPrice;
    const gain = currentValue - amount;
    const percent = (gain / amount) * 100;

    const days = Math.round(
      (new Date() - new Date(found.actualDate)) / (1000 * 60 * 60 * 24)
    );

    const xirr = computeXIRR([
      { date: new Date(found.actualDate + "T00:00:00Z"), amount: -amount },
      { date: new Date(dateEl.max + "T00:00:00Z"), amount: currentValue },
    ]);

    const fdValue = fdRatePercent != null
      ? computeFdValue([{ date: found.actualDate, amount }], fdRatePercent, dateEl.max)
      : null;

    return { buyPrice, currentPrice, btcQty, currentValue, gain, percent, days, actualDate: found.actualDate, xirr, fdValue };
  }

  function calculateSip(startDateStr, amountPerInstallment, currency, stepUpPercent, fdRatePercent) {
    const installments = computeSipInstallments(startDateStr, amountPerInstallment, currency, stepUpPercent);
    if (installments.length === 0) {
      throw new Error("No SIP installments fall within the available price history.");
    }

    let totalBtc = 0;
    let totalInvested = 0;
    const cashflows = [];
    for (const inst of installments) {
      totalBtc += inst.amount / inst.price;
      totalInvested += inst.amount;
      cashflows.push({ date: new Date(inst.date + "T00:00:00Z"), amount: -inst.amount });
    }

    const currentPrice = currentPrices[currency];
    const currentValue = totalBtc * currentPrice;
    cashflows.push({ date: new Date(dateEl.max + "T00:00:00Z"), amount: currentValue });

    const gain = currentValue - totalInvested;
    const percent = (gain / totalInvested) * 100;
    const avgBuyPrice = totalInvested / totalBtc;
    const xirr = computeXIRR(cashflows);

    const fdValue = fdRatePercent != null
      ? computeFdValue(installments, fdRatePercent, dateEl.max)
      : null;

    return {
      buyPrice: avgBuyPrice,
      currentPrice,
      btcQty: totalBtc,
      currentValue,
      gain,
      percent,
      totalInvested,
      installments: installments.length,
      startDate: startDateStr,
      lastDate: installments[installments.length - 1].date,
      xirr,
      fdValue,
    };
  }

  // Builds a {date, invested, value, fd?} series for the chart, day by day
  // from the first relevant date through the last available price date.
  // fdRatePercent is optional; when given, each point also carries the
  // FD-equivalent value of the same deposits as of that date.
  function buildTimeSeries(investType, dateStr, amount, currency, stepUpPercent, fdRatePercent) {
    const dates = sortedDates[currency];
    const map = priceHistory[currency];

    const events = investType === "lumpsum"
      ? (() => {
        const found = findPriceForDate(currency, dateStr);
        return found ? [{ date: found.actualDate, amount, price: found.price }] : [];
      })()
      : computeSipInstallments(dateStr, amount, currency, stepUpPercent);

    if (events.length === 0) return [];

    const startIdx = dates.indexOf(events[0].date);
    let cumBtc = 0;
    let cumInvested = 0;
    let evIdx = 0;
    const series = [];
    for (let i = startIdx; i < dates.length; i++) {
      const d = dates[i];
      while (evIdx < events.length && events[evIdx].date === d) {
        cumBtc += events[evIdx].amount / map.get(d);
        cumInvested += events[evIdx].amount;
        evIdx++;
      }
      const point = { date: d, invested: cumInvested, value: cumBtc * map.get(d) };
      if (fdRatePercent != null) {
        point.fd = computeFdValue(events.filter((e) => e.date <= d), fdRatePercent, d);
      }
      series.push(point);
    }
    return series;
  }

  let lastSeries = null;
  let lastState = null;

  function getFormState() {
    return {
      investType: getInvestType(),
      dateStr: dateEl.value,
      amount: parseFloat(amountEl.value),
      currency: currencyEl.value,
      stepUp: stepupEl.value ? Math.max(0, Math.min(100, parseFloat(stepupEl.value) || 0)) : 0,
      fdEnabled: fdToggleEl.checked,
      fdRate: fdRateEl.value ? Math.max(0, Math.min(30, parseFloat(fdRateEl.value) || 0)) : 7,
    };
  }

  function applyFormState(state) {
    document.querySelector(`input[name="invest-type"][value="${state.investType === "sip" ? "sip" : "lumpsum"}"]`).checked = true;
    dateEl.value = state.dateStr || "";
    amountEl.value = state.amount || "";
    currencyEl.value = state.currency === "usdt" ? "usdt" : "inr";
    stepupEl.value = state.stepUp || "";
    fdToggleEl.checked = !!state.fdEnabled;
    fdRateEl.value = state.fdRate || 7;
    updateFormForType();
    fdRateFieldEl.classList.toggle("hidden", !fdToggleEl.checked);
  }

  function updateUrlFromState(state) {
    const params = new URLSearchParams();
    params.set("type", state.investType);
    params.set("date", state.dateStr);
    params.set("amount", String(state.amount));
    params.set("currency", state.currency);
    if (state.investType === "sip" && state.stepUp) params.set("stepup", String(state.stepUp));
    if (state.fdEnabled) {
      params.set("fd", "1");
      params.set("fdrate", String(state.fdRate));
    }
    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState(null, "", newUrl);
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(location.search);
    if (!params.has("date") || !params.has("amount")) return null;
    const amount = parseFloat(params.get("amount"));
    if (!amount || amount <= 0) return null;
    return {
      investType: params.get("type") === "sip" ? "sip" : "lumpsum",
      dateStr: params.get("date"),
      amount,
      currency: params.get("currency") === "usdt" ? "usdt" : "inr",
      stepUp: parseFloat(params.get("stepup")) || 0,
      fdEnabled: params.get("fd") === "1",
      fdRate: parseFloat(params.get("fdrate")) || 7,
    };
  }

  function runCalculation() {
    clearError();
    resultEl.classList.add("hidden");
    chartSectionEl.classList.add("hidden");

    const state = getFormState();
    const { investType, dateStr, amount, currency, stepUp, fdEnabled, fdRate } = state;

    if (!dateStr) {
      showError(investType === "sip" ? "Please choose a SIP start date." : "Please choose an investment date.");
      return;
    }
    if (!amount || amount <= 0) {
      showError(investType === "sip" ? "Please enter a monthly amount greater than 0." : "Please enter an amount greater than 0.");
      return;
    }
    if (dateStr < dateEl.min || dateStr > dateEl.max) {
      showError(`Please pick a date between ${dateEl.min} and ${dateEl.max}.`);
      return;
    }

    try {
      const fdRatePercent = fdEnabled ? fdRate : null;
      const r = investType === "sip"
        ? calculateSip(dateStr, amount, currency, stepUp, fdRatePercent)
        : calculate(dateStr, amount, currency, fdRatePercent);

      buyPriceLabelEl.textContent = investType === "sip" ? "Average buy price" : "BTC price on invest date";
      document.getElementById("res-buy-price").textContent =
        investType === "sip"
          ? formatMoney(r.buyPrice, currency)
          : formatMoney(r.buyPrice, currency) + (r.actualDate !== dateStr ? ` (on ${r.actualDate})` : "");
      document.getElementById("res-btc-qty").textContent = formatBtc(r.btcQty);
      document.getElementById("res-current-price").textContent = formatMoney(r.currentPrice, currency);
      document.getElementById("res-current-value").textContent = formatMoney(r.currentValue, currency);
      document.getElementById("res-xirr").textContent = formatPercent(r.xirr);

      if (fdEnabled && r.fdValue != null) {
        fdItemEl.classList.remove("hidden");
        document.getElementById("res-fd-value").textContent = formatMoney(r.fdValue, currency);
      } else {
        fdItemEl.classList.add("hidden");
      }

      const headlineEl = document.getElementById("res-headline");
      const gainEl = document.getElementById("res-gain");
      const percentEl = document.getElementById("res-percent");

      const sign = r.gain >= 0 ? "+" : "-";
      gainEl.textContent = `${sign}${formatMoney(Math.abs(r.gain), currency)}`;
      percentEl.textContent = `${sign}${Math.abs(r.percent).toFixed(2)}%`;

      headlineEl.classList.remove("positive", "negative");
      headlineEl.classList.add(r.gain >= 0 ? "positive" : "negative");

      const daysEl = document.getElementById("res-days");
      if (investType === "sip") {
        totalInvestedItemEl.classList.remove("hidden");
        installmentsItemEl.classList.remove("hidden");
        document.getElementById("res-total-invested").textContent = formatMoney(r.totalInvested, currency);
        document.getElementById("res-installments").textContent =
          `${r.installments} (monthly${stepUp ? `, +${stepUp}%/yr` : ""})`;
        daysEl.textContent = `From ${r.startDate} to ${r.lastDate}`;
      } else {
        totalInvestedItemEl.classList.add("hidden");
        installmentsItemEl.classList.add("hidden");
        daysEl.textContent = `Held for ${r.days.toLocaleString()} day${r.days === 1 ? "" : "s"}`;
      }

      resultEl.classList.remove("hidden");

      const series = buildTimeSeries(investType, dateStr, amount, currency, stepUp, fdRatePercent);
      lastSeries = series;
      lastState = state;
      if (series.length >= 2 && typeof window.renderPortfolioChart === "function") {
        window.renderPortfolioChart(chartRootEl, series, currency, formatMoney);
        chartSectionEl.classList.remove("hidden");
      }

      updateUrlFromState(state);
    } catch (err) {
      showError(err.message);
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    runCalculation();
  });

  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const original = copyLinkBtn.textContent;
      copyLinkBtn.textContent = "Copied!";
      setTimeout(() => {
        copyLinkBtn.textContent = original;
      }, 1500);
    } catch (e) {
      logError("clipboard write failed", e);
      showError("Couldn't copy the link. Copy it from the address bar instead.");
    }
  });

  exportCsvBtn.addEventListener("click", () => {
    if (!lastSeries || !lastState) return;
    const hasFd = lastSeries[0].fd != null;
    const header = hasFd ? "date,invested,portfolio_value,fd_value" : "date,invested,portfolio_value";
    const rows = lastSeries.map((p) =>
      hasFd
        ? `${p.date},${p.invested.toFixed(2)},${p.value.toFixed(2)},${p.fd.toFixed(2)}`
        : `${p.date},${p.invested.toFixed(2)},${p.value.toFixed(2)}`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `btc-returns-${lastState.investType}-${lastState.dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  exportPngBtn.addEventListener("click", () => {
    if (typeof window.exportChartPng !== "function") return;
    window.exportChartPng(chartRootEl, `btc-returns-chart-${(lastState && lastState.dateStr) || "export"}.png`);
  });

  async function init() {
    log("init: starting");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Loading Bitcoin price history…";

    try {
      await loadCurrency("inr");
    } catch (err) {
      logError("init: INR load failed, aborting", err);
      statusEl.textContent = `Couldn't load Bitcoin price history: ${err.message}`;
      statusEl.classList.add("error-text");
      return;
    }

    try {
      await loadCurrency("usdt");
    } catch (err) {
      log("init: USDT load failed, disabling USDT option", err);
      usdtOptionEl.disabled = true;
      usdtOptionEl.textContent = "USDT (unavailable)";
    }

    const minDate = sortedDates.inr[0];
    const maxDate = sortedDates.inr[sortedDates.inr.length - 1];
    dateEl.min = minDate;
    dateEl.max = maxDate;
    dateHintEl.textContent = `Data available from ${minDate} to ${maxDate}`;

    statusEl.classList.add("hidden");
    formEl.classList.remove("hidden");
    log("init: done, form shown");

    const urlState = readStateFromUrl();
    if (urlState) {
      applyFormState(urlState);
      runCalculation();
    }
  }

  init();
})();
