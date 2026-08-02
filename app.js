(() => {
  const API_BASE = "https://api.coingecko.com/api/v3";
  const CACHE_KEY = "btc-history-cache-v1";
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  const API_KEY_STORAGE_KEY = "cg-demo-api-key";

  class ApiKeyError extends Error {}

  const apiKeySetupEl = document.getElementById("api-key-setup");
  const apiKeyInputEl = document.getElementById("api-key-input");
  const apiKeyErrorEl = document.getElementById("api-key-error");
  const saveKeyBtn = document.getElementById("save-key-btn");
  const statusEl = document.getElementById("status");
  const formEl = document.getElementById("calc-form");
  const dateEl = document.getElementById("date");
  const dateHintEl = document.getElementById("date-hint");
  const amountEl = document.getElementById("amount");
  const currencyEl = document.getElementById("currency");
  const submitBtn = document.getElementById("submit-btn");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");

  // currency -> Map(dateStr -> price)
  let priceHistory = { inr: new Map(), usdt: new Map() };
  let sortedDates = [];
  let currentPrices = { inr: null, usdt: null };

  function toDateStr(tsMs) {
    return new Date(tsMs).toISOString().slice(0, 10);
  }

  function buildMap(prices) {
    const map = new Map();
    for (const [ts, price] of prices) {
      map.set(toDateStr(ts), price);
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

  function getStoredApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  }

  async function fetchJson(url) {
    const apiKey = getStoredApiKey();
    const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 401) {
        throw new ApiKeyError("That API key was rejected. Please check it and try again.");
      }
      if (res.status === 429) {
        throw new Error("Rate limited by the price API. Please wait a moment and try again.");
      }
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }

  async function loadHistory() {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return cached;
        }
      } catch (_) {
        // ignore corrupt cache
      }
    }

    const [inrData, usdData] = await Promise.all([
      fetchJson(`${API_BASE}/coins/bitcoin/market_chart?vs_currency=inr&days=max`),
      fetchJson(`${API_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=max`),
    ]);

    const payload = {
      fetchedAt: Date.now(),
      inr: inrData.prices,
      usdt: usdData.prices,
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {
      // storage full or unavailable, safe to ignore
    }

    return payload;
  }

  function findPriceForDate(map, dateStr) {
    if (map.has(dateStr)) {
      return { price: map.get(dateStr), actualDate: dateStr };
    }
    // fall back to the closest earlier available date
    let fallback = null;
    for (const d of sortedDates) {
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

  function showApiKeySetup(errorMsg) {
    statusEl.classList.add("hidden");
    formEl.classList.add("hidden");
    apiKeySetupEl.classList.remove("hidden");
    apiKeyErrorEl.textContent = errorMsg || "";
    apiKeyErrorEl.classList.toggle("hidden", !errorMsg);
  }

  async function loadAndRender() {
    apiKeySetupEl.classList.add("hidden");
    statusEl.classList.remove("hidden", "error-text");
    statusEl.textContent = "Loading Bitcoin price history…";

    try {
      const data = await loadHistory();
      priceHistory.inr = buildMap(data.inr);
      priceHistory.usdt = buildMap(data.usdt);
      sortedDates = [...priceHistory.inr.keys()].sort();

      currentPrices.inr = data.inr[data.inr.length - 1][1];
      currentPrices.usdt = data.usdt[data.usdt.length - 1][1];

      const minDate = sortedDates[0];
      const maxDate = sortedDates[sortedDates.length - 1];
      dateEl.min = minDate;
      dateEl.max = maxDate;
      dateHintEl.textContent = `Data available from ${minDate} to ${maxDate}`;

      statusEl.classList.add("hidden");
      formEl.classList.remove("hidden");
    } catch (err) {
      if (err instanceof ApiKeyError) {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        showApiKeySetup(err.message);
        return;
      }
      statusEl.textContent = `Couldn't load Bitcoin price history: ${err.message}`;
      statusEl.classList.add("error-text");
    }
  }

  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInputEl.value.trim();
    if (!key) {
      apiKeyErrorEl.textContent = "Please paste your API key.";
      apiKeyErrorEl.classList.remove("hidden");
      return;
    }
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    loadAndRender();
  });

  function init() {
    if (!getStoredApiKey()) {
      showApiKeySetup();
      return;
    }
    loadAndRender();
  }

  function calculate(dateStr, amount, currency) {
    const map = priceHistory[currency];
    const found = findPriceForDate(map, dateStr);
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
