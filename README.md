# V1000 — Additive Feature Upgrade

This package starts from the saved Ultra Next Gen Pro Predictor dashboard and adds ONLY:

1. Competitions -> South Africa / Africa filters
2. Additional provider adapter for competitions football-data.org does not cover
3. Manual Slip
4. Add/remove selections
5. Market selection
6. Stake and potential-return calculation
7. Slip save/load
8. Manual-slip analysis through the same probability inputs/engine path
9. Auto Slip remains separate and is not modified by the Manual Slip controls

## Run

Node.js 18+:
```bash
npm install
npm start
```

Open the displayed local URL.

## Environment

Copy `.env.example` to `.env` and configure provider keys in the hosting platform.

- `FOOTBALL_DATA_API_KEY` = football-data.org
- `API_FOOTBALL_KEY` = additional football provider
- `TWELVE_DATA_API_KEY` = kept separate for the existing Twelve Data integration

The additional provider adapter is intentionally isolated in `server.js`, and normalized competition records are merged without replacing football-data.org records.

## Notes

Manual slips are stored in browser local storage. Auto Slip has no shared state with Manual Slip.
Model probabilities are estimates and are not guarantees.
