# btc-returns-calculator

A simple Bitcoin returns calculator. Enter a past date and an amount (in INR
or USDT), and it shows what that investment would be worth today based on
Bitcoin's historical and current price.

## How it works

- On load, the app fetches Bitcoin's daily closing-price history (from
  2020-03-10 to today) for `BTC-INR` from [ZebPay](https://zebpay.com)'s
  public klines API, and caches it in `localStorage` for an hour to avoid
  refetching. It also tries `BTC-USDT`; if that pair isn't available, the
  USDT option is disabled and INR still works normally.
- You pick an investment date and enter an amount + currency.
- The app looks up the BTC closing price on that date, computes how much BTC
  that amount would have bought, and multiplies it by the current price to
  show the current value, absolute gain/loss, and percentage return.
- If a date has no exact daily candle, it falls back to the closest prior
  available date.

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
