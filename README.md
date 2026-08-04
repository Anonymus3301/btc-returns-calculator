# btc-returns-calculator

A Bitcoin returns calculator. Enter a past date and an amount (in INR or
USDT) as either a one-time lump sum or a monthly SIP, and it shows what that
investment would be worth today based on Bitcoin's historical and current
price — plus a chart, an annualized return, and an optional Fixed Deposit
comparison.

## How it works

- On load, the app fetches Bitcoin's daily closing-price history (from
  2020-03-10 to today) for `BTC-INR` from [ZebPay](https://zebpay.com)'s
  public klines API, and caches it in `localStorage` for an hour to avoid
  refetching. It also tries `BTC-USDT`; if that pair isn't available, the
  USDT option is disabled and INR still works normally.
- Pick **Lump sum** (a single investment date + amount) or **SIP** (a start
  date + monthly amount, optionally increasing by an annual step-up %).
- The app looks up the BTC closing price on each relevant date, computes how
  much BTC that amount would have bought, and multiplies it by the current
  price to show the current value, absolute gain/loss, percentage return,
  and **annualized return (XIRR)** — computed generically from the actual
  cashflow dates and amounts, so it works the same way for a single lump sum
  or an irregular step-up SIP.
- If a date has no exact daily candle, it falls back to the closest prior
  available date.
- A **chart** plots invested capital vs. mark-to-market portfolio value over
  time (and optionally a Fixed Deposit comparison line — a pure
  interest-formula benchmark at a rate you set, not real market data), with
  a hover/keyboard tooltip.
- **Share a result** via the URL (inputs are encoded as query params after
  each calculation, and a page loaded with those params auto-fills the form
  and recalculates) or the **Copy share link** button. **Export CSV** downloads
  the full time series; **Export PNG** downloads the chart as a standalone image.

## Running it

This is a static site with no build step, dependencies, or API key required.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. It can also be deployed as-is
to any static host (GitHub Pages, Netlify, Vercel, S3, etc.).

## Notes

- Price data comes directly from ZebPay's public market API
  (`www.zebapi.com/api/v2/market/klines`), the same endpoint zebpay.com's own
  site uses — no API key needed.
- History starts from a fixed date (`START_DATE_SEC` in `app.js`, currently
  2020-03-10); the date picker is bounded to whatever range the API actually
  returns. If the API caps how many candles it returns per request, the
  earliest available date may end up later than the requested start — check
  the `[btc-calc]` console logs, which report the actual min/max date loaded.
- This relies on an undocumented third-party endpoint with permissive CORS
  for zebpay.com's own frontend; if ZebPay changes or restricts it, the app's
  status area will show a fetch error.
- The Fixed Deposit line is the only benchmark included, because it's a pure
  formula (no external data needed). Real Nifty/Gold benchmarks would need a
  verified, keyless, CORS-friendly historical data source, which isn't
  wired up — fabricating that data instead was ruled out.
