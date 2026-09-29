# Ultra Next Gen Pro Predictor 31.1

Mobile-friendly Node/Express football dashboard with provider sync, live/upcoming fixtures, competition search and a connected strategy/slip generator.

## Included
- API-Football live fixture sync when `API_FOOTBALL_KEY` is configured.
- API-Football upcoming fixtures for the next 3 days.
- football-data.org fallback/upcoming sync with a 9-day window to avoid its 10-day period limit.
- Competition discovery from API-Football plus configured South African/African competition labels.
- Live/upcoming/finished dashboard filters.
- Strategy panel with budget, target, duration and risk settings.
- Connected `Generate Slip` endpoint that selects qualifying upcoming matches, avoids duplicate teams, calculates model-implied combined probability and estimated return, and stores slip history.
- No guaranteed accuracy or winnings; estimated odds are model-implied, not bookmaker prices.

## Environment
Copy `.env.example` into your deployment environment and set:
- `API_FOOTBALL_KEY` = API-Football key
- `FOOTBALL_DATA_API_KEY` = football-data.org key (optional fallback)
- `LIVE_POLL_SECONDS=90`
- `SYNC_MINUTES=30`

Do not put API keys in the frontend.

## Deploy
Use a Node-capable host such as Render. GitHub Pages can host the static frontend but cannot run this Node/Express backend or perform server-side provider synchronization.

Start command: `npm start`

## Slip engine
The slip generator is connected to the live fixture store at `/api/slips/generate`. It filters future fixtures inside the selected duration, applies the selected risk threshold, selects the strongest model market per fixture, limits legs, avoids repeating teams, and records the generated slip at `/api/slips`.

This is a probability-analysis tool. It does not guarantee 98% accuracy, a target return, or a winning bet.
