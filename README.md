# Ultra Next Gen Pro Predictor — V1000 Combined

This build preserves the dark navy/blue/purple predictor direction and adds the requested features without merging Manual Slip state into Auto Slip state.

## Added
- Competition filters: All / South Africa / Africa / Other.
- Secondary competition provider adapter: API-Football, optional.
- Manual Slip: add/remove selections, market selection, optional odds, stake and projected return.
- Save/load Manual Slips with phone-friendly localStorage.
- Manual Slip analysis uses the same prediction engine module used by the match cards/Auto Slip.
- Auto Slip remains a separate view and state, with configurable confidence threshold (default 90%).
- Graceful demo fallback when no API keys are configured.
- football-data.org date window defaults to 9 days to avoid the previously encountered >10-day request error.

## Providers
football-data.org uses the `X-Auth-Token` header and exposes competition and match resources. See official docs: https://www.football-data.org/documentation/quickstart
API-Football uses `x-apisports-key` and its fixtures/leagues resources cover a broad competition set. See official docs: https://www.api-football.com/documentation-v3

## Environment
Copy `.env.example` to `.env` and set:
- `FOOTBALL_DATA_API_KEY` — football-data.org token (not a Twelve Data key).
- `API_FOOTBALL_KEY` — API-Football/API-Sports key (optional but recommended for extra competition coverage).
- `LIVE_POLL_SECONDS=90`
- `FOOTBALL_DATA_DAYS=9`

## Run
npm install
npm start

Then open port 10000 (or your configured PORT).

## Deployment
Works on Node/Express hosts such as Render. Set the environment variables in the host dashboard instead of committing `.env`.

## Important
Prediction percentages are model confidence estimates, not guaranteed betting accuracy or guaranteed returns. Odds are not fabricated: if no odds feed is configured, the Manual Slip accepts user-entered odds and defaults to 1.00 only as a neutral placeholder.
