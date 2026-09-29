# V500 — Automatic Slip Generation

Built on V100 without removing existing modules or UI.

## Added
- Automatic 90%+ model-threshold slip generation now persists the generated slip to the signed-in user account.
- Every generated auto slip receives a CRATTO app share code.
- Saved auto slips appear in My Slip Codes.
- Auto Slip output now shows the generated code and provides a direct route to Slip Codes.
- Auto generation remains based on the existing confidence, historical-accuracy and minimum-history filters.
- No qualifying selections still produces a clear no-slip result instead of saving an empty slip.

## Preserved
- Existing V100 live-match and SA/Africa coverage work.
- Existing dashboard, predictor, Strategy Lab, portfolio, analytics, model, diagnostics, account and Slip Codes modules.
- Existing 90-second live polling and provider/cache behavior.

## Important
The 90% value is a model selection threshold, not a guarantee that a match or slip will win. A valid football-data.org API key and provider access are still required for fresh provider data.
