# btc-returns-calculator

A simple Bitcoin returns calculator. Enter a past date and an amount (in INR
or USDT), and it shows what that investment would be worth today based on
Bitcoin's historical and current price.

## How it works

- On first load, the app asks for a free CoinGecko Demo API key (see
  [API key setup](#api-key-setup) below) and stores it in `localStorage`.
- It then fetches Bitcoin's full daily closing-price history in INR and USD
  (used as a 1:1 proxy for USDT) from the [CoinGecko](https://www.coingecko.com)
  API, and caches it in `localStorage` for an hour to avoid refetching.
- You pick an investment date and enter an amount + currency.
- The app looks up the BTC price on that date, computes how much BTC that
  amount would have bought, and multiplies it by the current price to show
  the current value, absolute gain/loss, and percentage return.
- If a date has no exact daily snapshot, it falls back to the closest prior
  available date.

## Running it

This is a static site with no build step or dependencies.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. It can also be deployed as-is
to any static host (GitHub Pages, Netlify, Vercel, S3, etc.).

## API key setup

CoinGecko's public API now requires a free "Demo" API key (100 requests/min,
10,000/month, no cost, no credit card):

1. Sign up and create a key at the [CoinGecko developer dashboard](https://www.coingecko.com/en/developers/dashboard).
2. Open the app — on first load it will prompt for the key and save it to
   your browser's `localStorage`. It's sent only to CoinGecko, never anywhere
   else, and never committed to this repo.
3. If a key is later rejected (401), the app clears it and re-prompts.

## Notes

- USDT is treated as pegged 1:1 to USD, since CoinGecko doesn't provide a
  separate long-running USDT-denominated BTC history.
- Historical data goes back to CoinGecko's earliest available BTC record
  (~April 2013); the date picker is bounded to the available range.
- The CoinGecko API is rate-limited; if you hit a rate limit, wait a moment
  and retry.
