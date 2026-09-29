# V1000 Final

Built from V500 without removing the existing platform.

## Added
- Manual slip builder inside Slip Builder & Codes.
- Loads upcoming model predictions for manual selection.
- Match-by-match market selection.
- Add/remove selections.
- Manual budget and stake fields.
- Saves the custom slip through the existing authenticated slip API.
- Generates a CRATTO share code and immediately refreshes saved codes.
- Existing auto-slip generation remains available in Strategy Lab.
- Existing live matches, SA/Africa coverage, predictor, analytics, portfolio, diagnostics and account features remain intact.

## Important
- Model confidence/accuracy values are statistical estimates, not guarantees.
- Fresh football data still requires a valid football-data.org API token and provider access to the requested competitions.


## Hybrid merge update
- V1000 UI remains the visual source of truth: original header, drawer menu, page structure, footer and dark-blue styling are preserved.
- Predictor now supports All / South Africa / Africa competition filters.
- Optional API-Sports secondary provider adapter imports configured competitions that football-data.org does not cover.
- Manual Slip remains separate from Auto Slip and now includes per-selection odds plus combined-odds, stake, potential-return and profit calculation.
- Auto Slip continues to use its own 90% model-threshold workflow and is not mixed into Manual Slip selections.
- 90% values remain model thresholds/statistical estimates, not guarantees.
