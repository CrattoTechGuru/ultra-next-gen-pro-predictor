# V100 — Live Match + African Coverage Add-on

Base: V50 Old UI + 90% Accuracy + Auto Slip.

## Added without removing the V50 build
- Live feed now queries the provider globally with `status=LIVE` instead of restricting the request to the previously discovered competition-code list.
- Live cached fallback remains enabled.
- Competition discovery now retains competitions that have an ID but no human-readable code.
- South African/African competitions are detected from provider area metadata.
- African/South African competition teams can be discovered through the competition teams endpoint.
- Added `/api/coverage/africa` for explicit SA/Africa competition and team coverage inspection.
- Competition selector can use either provider code or competition ID.
- Existing V50 prediction, auto-slip, dashboard and UI modules are retained.

## Provider limitation
The app cannot manufacture live fixtures or competitions that the configured football-data.org account does not expose. A valid `FOOTBALL_DATA_API_KEY` and the provider's available permissions are required.
