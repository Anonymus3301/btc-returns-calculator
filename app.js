(() => {
  const API_BASE = "https://www.zebapi.com/api/v2/market";
  const SYMBOLS = { inr: "BTC-INR", usdt: "BTC-USDT" };
  const LOOKBACK_DAYS = 730;
  const CACHE_PREFIX = "btc-klines-v2-";
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

  async function fetchKlines(symbol) {
    const cacheKey = CACHE_PREFIX + symbol;
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (
          Array.isArray(cached.klines) &&
          cached.klines.length > 0 &&
          Date.now() - cached.fetchedAt < CACHE_TTL_MS
        ) {
          return cached.klines;
        }
      } catch (_) {
        // ignore corrupt cache
      }
    }

    // The API only returns data for day-aligned (UTC midnight) start/end
    // timestamps; a non-aligned range silently returns an empty array.
    const DAY_SEC = 24 * 60 * 60;
    const todayMidnightSec = Math.floor(Date.now() / (DAY_SEC * 1000)) * DAY_SEC;
    const endSec = todayMidnightSec + DAY_SEC;
    const startSec = endSec - LOOKBACK_DAYS * DAY_SEC;
    const url = `${API_BASE}/klines?symbol=${symbol}&interval=1d&startTime=${startSec}&endTime=${endSec}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Rate limited. Please wait a moment and try again.");
      }
      throw new Error(`Request failed (${res.status})`);
    }
    const body = await res.json();
    const klines = Array.isArray(body) ? body : body.data;

    if (Array.isArray(klines) && klines.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), klines }));
      } catch (_) {
        // storage full or unavailable, safe to ignore
      }
    }

    return klines;
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
    const klines = await fetchKlines(SYMBOLS[currency]);
    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error("No data returned.");
    }
    priceHistory[currency] = buildMap(klines);
    sortedDates[currency] = [...priceHistory[currency].keys()].sort();
    const maxDate = sortedDates[currency][sortedDates[currency].length - 1];
    currentPrices[currency] = priceHistory[currency].get(maxDate);
  }

  async function init() {
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Loading Bitcoin price history…";

    try {
      await loadCurrency("inr");
    } catch (err) {
      statusEl.textContent = `Couldn't load Bitcoin price history: ${err.message}`;
      statusEl.classList.add("error-text");
      return;
    }

    try {
      await loadCurrency("usdt");
    } catch (_) {
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
