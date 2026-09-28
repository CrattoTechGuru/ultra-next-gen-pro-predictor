# Ultra Next Gen Pro Predictor — CRATTO CTRL 11.0

A Node.js/Express football analytics application using football-data.org v4 as a server-side data provider.

## Features
- Upcoming fixture retrieval
- Poisson-based probability model
- Venue-specific recent form
- Home/draw/away, over 2.5 and BTTS probabilities
- Confidence and risk bands
- Rules-based strategy generator
- Historical data sync
- Walk-forward backtesting with accuracy and Brier score
- CRATTO CTRL dashboard

## Run locally
```bash
npm install
cp .env.example .env
# Put your football-data.org token in .env
npm start
```

Open `http://localhost:10000`.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `FOOTBALL_DATA_API_KEY`

The server binds to `0.0.0.0` and uses Render's `PORT` variable.

## Important
Predictions are statistical estimates. Backtest results are not guarantees of future accuracy, profit, or returns.
