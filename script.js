/**
 * Live Stock Price Dashboard
 * -------------------------------------------------------------
 * Talks to the Alpha Vantage REST API (GLOBAL_QUOTE + TIME_SERIES_DAILY),
 * computes a 10-day simple moving average from the raw historical closes,
 * and renders the result — all without blocking the page while the
 * network calls are in flight.
 *
 * Error handling is split into three distinct paths on purpose, because
 * "the request failed" isn't one problem — it's three different problems
 * with three different fixes:
 *   1. NetworkError     fetch() itself never got a response (offline, DNS, etc.)
 *   2. InvalidSymbolError  Alpha Vantage responded fine, but the ticker doesn't exist
 *   3. RateLimitError   the free-tier request quota has been used up
 */

const BASE_URL = "https://www.alphavantage.co/query";

class NetworkError extends Error {}
class InvalidSymbolError extends Error {}
class RateLimitError extends Error {}

// ---------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------
const form = document.getElementById("search-form");
const tickerInput = document.getElementById("ticker-input");
const apiKeyInput = document.getElementById("api-key-input");
const searchButton = document.getElementById("search-button");

const emptyState = document.getElementById("empty-state");
const skeleton = document.getElementById("skeleton");
const errorCard = document.getElementById("error-card");
const errorTitle = document.getElementById("error-title");
const errorMessage = document.getElementById("error-message");
const errorHint = document.getElementById("error-hint");
const resultCard = document.getElementById("result-card");
const chips = document.querySelectorAll(".chip");

const els = {
  symbol: document.getElementById("result-symbol"),
  price: document.getElementById("result-price"),
  change: document.getElementById("result-change"),
  sparkline: document.getElementById("sparkline-container"),
  rangeMarker: document.getElementById("range-marker"),
  rangeLow: document.getElementById("range-low"),
  rangeHigh: document.getElementById("range-high"),
  sma: document.getElementById("result-sma"),
  trend: document.getElementById("result-trend"),
  meta: document.getElementById("result-meta"),
};

// ---------------------------------------------------------------
// Networking + parsing
// ---------------------------------------------------------------

/**
 * Wraps fetch + Alpha Vantage's quirky "always return 200" error style
 * into three typed errors the UI can branch on.
 */
async function fetchJSON(params) {
  const url = `${BASE_URL}?${new URLSearchParams(params).toString()}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    // fetch() only rejects for network-level failures: offline, DNS
    // resolution failure, or a CORS block. A bad ticker or a rate
    // limit still comes back as a normal 200 response, which is why
    // this catch block is ONLY for true connectivity failures.
    throw new NetworkError(
      "Couldn't reach Alpha Vantage. Check your internet connection and try again."
    );
  }

  if (!response.ok) {
    throw new NetworkError(`Alpha Vantage returned an unexpected status: ${response.status}.`);
  }

  const data = await response.json();

  // Alpha Vantage encodes both "bad request" and "quota exceeded" as
  // 200 OK responses with a special key instead of an HTTP error code,
  // so those have to be checked for explicitly.
  if (data["Note"] || data["Information"]) {
    throw new RateLimitError(data["Note"] || data["Information"]);
  }
  if (data["Error Message"]) {
    throw new InvalidSymbolError(data["Error Message"]);
  }

  return data;
}

async function fetchQuote(symbol, apiKey) {
  const data = await fetchJSON({ function: "GLOBAL_QUOTE", symbol, apikey: apiKey });
  const quote = data["Global Quote"];

  if (!quote || Object.keys(quote).length === 0) {
    throw new InvalidSymbolError(`No quote found for "${symbol}". Double-check the ticker symbol.`);
  }

  return {
    symbol: quote["01. symbol"],
    price: parseFloat(quote["05. price"]),
    change: parseFloat(quote["09. change"]),
    changePercent: parseFloat(quote["10. change percent"]),
    latestTradingDay: quote["07. latest trading day"],
  };
}

async function fetchDailyHistory(symbol, apiKey) {
  // outputsize=full (not the default "compact") because compact only
  // returns the last ~100 trading days — about 20 weeks, not 52.
  const data = await fetchJSON({
    function: "TIME_SERIES_DAILY",
    symbol,
    outputsize: "full",
    apikey: apiKey,
  });

  const series = data["Time Series (Daily)"];
  if (!series) {
    throw new InvalidSymbolError(`No historical data found for "${symbol}". Double-check the ticker symbol.`);
  }

  // Newest first, since every downstream calculation wants "the last N days".
  return Object.entries(series)
    .map(([date, values]) => ({ date, close: parseFloat(values["4. close"]) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------

function calculateSMA(history, period = 10) {
  if (history.length < period) return null;
  const recentDays = history.slice(0, period);
  const sum = recentDays.reduce((total, day) => total + day.close, 0);
  return sum / period;
}

function calculate52WeekRange(history) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const lastYear = history.filter((day) => new Date(day.date) >= oneYearAgo);
  const closes = lastYear.length > 0 ? lastYear.map((d) => d.close) : history.map((d) => d.close);

  return { low: Math.min(...closes), high: Math.max(...closes) };
}

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------

function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

/**
 * Builds a small SVG line-and-area chart from daily closes. Reuses the
 * same history array already fetched for the SMA/range calculations —
 * no extra request, no charting library needed for something this simple.
 */
function renderSparkline(history) {
  const days = history.slice(0, 30).slice().reverse(); // oldest -> newest, left to right
  const closes = days.map((d) => d.close);

  if (closes.length < 2) {
    els.sparkline.innerHTML = '<p class="sparkline-empty">Not enough history to chart.</p>';
    return;
  }

  const width = 240;
  const height = 56;
  const padX = 2;
  const padY = 6;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const step = (width - padX * 2) / (closes.length - 1);

  const points = closes
    .map((close, i) => {
      const x = padX + i * step;
      const y = padY + (height - padY * 2) * (1 - (close - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const firstX = padX;
  const lastX = padX + step * (closes.length - 1);
  const areaPoints = `${points} ${lastX.toFixed(1)},${height} ${firstX.toFixed(1)},${height}`;

  const trendClass = closes[closes.length - 1] >= closes[0] ? "positive" : "negative";

  els.sparkline.innerHTML = `
    <svg class="sparkline ${trendClass}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#sparkFill)" />
      <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function renderResult({ quote, sma, range, history }) {
  els.symbol.textContent = quote.symbol;
  els.price.textContent = formatCurrency(quote.price);

  const isUp = quote.change >= 0;
  els.change.textContent = `${isUp ? "▲" : "▼"} ${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;
  els.change.className = `change-pill ${isUp ? "positive" : "negative"}`;
  els.price.className = `price ${isUp ? "positive" : "negative"}`;

  renderSparkline(history);

  els.rangeLow.textContent = formatCurrency(range.low);
  els.rangeHigh.textContent = formatCurrency(range.high);

  const span = range.high - range.low;
  const position = span > 0 ? ((quote.price - range.low) / span) * 100 : 50;
  els.rangeMarker.style.left = `${Math.min(100, Math.max(0, position))}%`;

  if (sma === null) {
    els.sma.textContent = "n/a";
    els.trend.textContent = "Not enough history";
    els.trend.className = "stat-value";
  } else {
    els.sma.textContent = formatCurrency(sma);
    const aboveSMA = quote.price >= sma;
    els.trend.textContent = aboveSMA ? "▲ Above SMA" : "▼ Below SMA";
    els.trend.className = `stat-value ${aboveSMA ? "positive" : "negative"}`;
  }

  els.meta.textContent = `As of ${quote.latestTradingDay}`;

  resultCard.hidden = false;
}

const ERROR_COPY = {
  network: {
    title: "Connection problem",
    hint: "This is a connectivity issue, not a bad ticker — the request never made it back.",
  },
  ticker: {
    title: "Symbol not found",
    hint: "Try the exchange ticker, not the company name — e.g. \"AAPL\", not \"Apple\".",
  },
  "rate-limit": {
    title: "Rate limit hit",
    hint: "Free-tier Alpha Vantage keys are capped at a few requests per minute. Wait a bit and retry.",
  },
  "missing-key": {
    title: "API key needed",
    hint: "Paste a free key above, or drop it into config.js so you don't have to re-enter it each time.",
  },
  unknown: {
    title: "Something went wrong",
    hint: "Check the browser console for the full error.",
  },
};

function showError(type, message) {
  const copy = ERROR_COPY[type] || ERROR_COPY.unknown;
  errorCard.className = `error-card ${type}`;
  errorTitle.textContent = copy.title;
  errorMessage.textContent = message;
  errorHint.textContent = copy.hint;
  errorCard.hidden = false;
}

function hideError() {
  errorCard.hidden = true;
}

function setLoading(isLoading) {
  searchButton.disabled = isLoading;
  tickerInput.disabled = isLoading;
  apiKeyInput.disabled = isLoading;
  chips.forEach((chip) => {
    chip.disabled = isLoading;
  });
  skeleton.hidden = !isLoading;
  if (isLoading) {
    resultCard.hidden = true;
  }
}

// ---------------------------------------------------------------
// Key resolution: runtime input overrides config.js for this session only.
// Nothing here ever touches localStorage/sessionStorage — an API key
// sitting in browser storage is one XSS bug away from being stolen.
// ---------------------------------------------------------------
function resolveApiKey() {
  const typed = apiKeyInput.value.trim();
  if (typed) return typed;

  const configured = window.CONFIG && window.CONFIG.ALPHA_VANTAGE_API_KEY;
  if (configured && configured !== "YOUR_API_KEY_HERE") return configured;

  return null;
}

// ---------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------
async function handleSearch(event) {
  event.preventDefault();

  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) return;

  emptyState.hidden = true;

  const apiKey = resolveApiKey();
  if (!apiKey) {
    hideError();
    showError("missing-key", "No API key found.");
    return;
  }

  hideError();
  setLoading(true);

  try {
    // The quote and the daily history don't depend on each other, so
    // they're fired concurrently instead of one after another — this
    // is the "parsing nested JSON asynchronously without blocking the
    // UI" part: the page stays responsive while both requests are
    // in flight, and the whole search finishes in one round trip's
    // worth of time instead of two.
    const [quote, history] = await Promise.all([
      fetchQuote(symbol, apiKey),
      fetchDailyHistory(symbol, apiKey),
    ]);

    const sma = calculateSMA(history, 10);
    const range = calculate52WeekRange(history);
    renderResult({ quote, sma, range, history });
  } catch (err) {
    if (err instanceof RateLimitError) {
      showError("rate-limit", err.message);
    } else if (err instanceof InvalidSymbolError) {
      showError("ticker", err.message);
    } else if (err instanceof NetworkError) {
      showError("network", err.message);
    } else {
      showError("unknown", "An unexpected error occurred.");
      console.error(err);
    }
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", handleSearch);

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    tickerInput.value = chip.dataset.symbol;
    if (form.requestSubmit) {
      form.requestSubmit();
    } else {
      handleSearch(new Event("submit", { cancelable: true }));
    }
  });
});
