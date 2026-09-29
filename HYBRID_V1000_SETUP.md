# V1000 Hybrid Build — Setup

This build keeps the V1000 interface as the source of truth and merges the requested functionality without replacing the original menu, footer, page structure, or dark-blue visual system.

## Included
- Original V1000 dashboard, drawer/menu and footer.
- Live and upcoming matches with model predictions.
- South Africa and Africa competition filters.
- Existing football-data.org provider integration.
- Optional secondary API-Sports adapter for configured competitions not available from football-data.org.
- Manual Slip kept separate from Auto Slip.
- Manual selection add/remove and market selection.
- Per-selection odds with combined odds, stake, potential return and profit calculation.
- Slip save/load and CRATTO share codes.
- Historical/team-form analysis and match accuracy fields.
- Auto Slip 90% model-threshold workflow and alerting.
- Existing analytics, portfolio, intelligence, diagnostics, model registry, operations, notifications and account modules.

## Primary provider
Set `FOOTBALL_DATA_API_KEY` to your football-data.org token.

## Optional secondary provider
Set:
- `API_SPORTS_KEY`
- `API_SPORTS_LEAGUE_IDS` (comma-separated league IDs)
- `API_SPORTS_SEASON` (season year)

The secondary adapter is optional. If it is not configured, the primary provider continues to work normally.

## Important
The app's 90% values are model thresholds/statistical estimates. They are not guarantees of match outcomes or financial returns.
