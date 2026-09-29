# V50 — 90% Accuracy / Auto Slip Add-on

This release preserves the V50 interface and adds the requested prediction workflow without replacing the existing design.

## Added
- Match-level historical accuracy indicator on prediction cards.
- Historical sample controls: at least 2 prior league matches or 5 prior cup matches when provider data is available.
- Historical accuracy is calculated from walk-forward checks against stored finished matches; it is not presented as a guaranteed future result.
- `GET /api/auto-slip/opportunities` to scan upcoming matches for the 90% threshold.
- `POST /api/auto-slip/generate` to form an automatic slip from matches meeting both 90% confidence and 90% historical-accuracy thresholds.
- Auto-slip monitoring in the existing frontend with browser notification support when a qualifying opportunity appears while the app is open.
- Existing strategy/slip builder remains intact.

## Important
- A 90% threshold means the model's configured threshold, not a guaranteed 90% real-world success rate.
- If the available historical data does not meet the minimum sample requirement, the match is not treated as a 90% historical-accuracy opportunity.
