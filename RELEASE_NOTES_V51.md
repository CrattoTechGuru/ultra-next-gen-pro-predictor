# Ultra Next Gen Pro Predictor — V51

## Data bootstrap and provider reliability
- Standardized football-data.org date windows to a maximum of 9 days.
- Set default `HISTORY_DAYS=9` and `UPCOMING_DAYS=9`.
- Manual refresh requests are clamped to 9 days.
- Fresh-deployment bootstrap is clamped to 9 days.
- Existing chunked provider requests remain enabled so a requested period can never exceed the provider limit.
- Preserved live polling at 90 seconds and the 30-minute scheduled sync.
- Added a Render blueprint with the production start command and safe secret placeholders.
- Added a minimal `.gitignore` for deployment repositories.

## Validation
- Node syntax checks passed for the server and application modules.
