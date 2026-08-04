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
  const dateHintEl = document.getElementById("date-hint");
  const amountEl = document.getElementById("amount");
  const currencyEl = document.getElementById("currency");
  const usdtOptionEl = document.getElementById("usdt-option");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");

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
  }

  function calculate(dateStr, amount, currency) {
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

    return { buyPrice, currentPrice, btcQty, currentValue, gain, percent, days, actualDate: found.actualDate };
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();
    resultEl.classList.add("hidden");

    const dateStr = dateEl.value;
    const amount = parseFloat(amountEl.value);
    const currency = currencyEl.value;

    if (!dateStr) {
      showError("Please choose an investment date.");
      return;
    }
    if (!amount || amount <= 0) {
      showError("Please enter an amount greater than 0.");
      return;
    }
    if (dateStr < dateEl.min || dateStr > dateEl.max) {
      showError(`Please pick a date between ${dateEl.min} and ${dateEl.max}.`);
      return;
    }

    try {
      const r = calculate(dateStr, amount, currency);

      document.getElementById("res-buy-price").textContent =
        formatMoney(r.buyPrice, currency) + (r.actualDate !== dateStr ? ` (on ${r.actualDate})` : "");
      document.getElementById("res-btc-qty").textContent = formatBtc(r.btcQty);
      document.getElementById("res-current-price").textContent = formatMoney(r.currentPrice, currency);
      document.getElementById("res-current-value").textContent = formatMoney(r.currentValue, currency);

      const headlineEl = document.getElementById("res-headline");
      const gainEl = document.getElementById("res-gain");
      const percentEl = document.getElementById("res-percent");

      const sign = r.gain >= 0 ? "+" : "-";
      gainEl.textContent = `${sign}${formatMoney(Math.abs(r.gain), currency)}`;
      percentEl.textContent = `${sign}${Math.abs(r.percent).toFixed(2)}%`;

      headlineEl.classList.remove("positive", "negative");
      headlineEl.classList.add(r.gain >= 0 ? "positive" : "negative");

      document.getElementById("res-days").textContent = `Held for ${r.days.toLocaleString()} day${r.days === 1 ? "" : "s"}`;

      resultEl.classList.remove("hidden");
    } catch (err) {
      showError(err.message);
    }
  });

  init();
})();
