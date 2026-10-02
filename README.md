# NexTownAir

Map-first flight discovery and itinerary planning focused on Essential Air Service and other small-airport routes.

## Canonical deployment

- **Repository:** `khwalser/nextownair-site`
- **Production branch:** `main`
- **Netlify project:** `nextownair-site`
- **Custom domain:** `nextownair.com`
- **Hosting:** Netlify connected to GitHub

## Current architecture

### Live fares

Live flight pricing is **Duffel only** through:

`netlify/functions/flight-proxy.js`

There is no Amadeus fallback and no sample-flight fallback.

The browser fare queue:

- prioritizes selected and nearby calendar dates
- distinguishes `queued` from `pricing…`
- propagates Duffel HTTP 429 rate limits and reset timing
- pauses and resumes automatically
- renders the actual returned fare choices on flight cards

### Published schedules

Published schedule availability is provided by AeroDataBox through API.Market via:

`netlify/functions/schedule-proxy.mjs`

The current API.Market trial quota is exhausted. The upstream response is detected as:

`schedule_quota_exhausted`

When that occurs, the itinerary calendar falls back to Duffel live fare/date checks and keeps dates selectable instead of freezing on an incomplete schedule count.

### Secrets

Netlify stores these as secrets:

- `DUFFEL_ACCESS_TOKEN`
- `AERODATABOX_API_MARKET_KEY`

Do not commit secrets to this repository.

## Route network

- 183 EAS communities
- 233 declared verified route edges
- all 233 declared route edges have passed regression testing in both directions
- the overall graph currently has 23 disconnected components

Passing all declared route-edge tests does **not** mean every arbitrary airport pair is routable. Cross-component routing is still unresolved.

Automatic connector insertion is implemented for routable paths, inserted connectors are highlighted, and route edits re-repair the route.

## Browser E2E

Rendered behavior is tested with Playwright through GitHub Actions:

- test: `e2e/live-itinerary.mjs`
- workflow: `.github/workflows/live-e2e.yml`

The live E2E path targets a deployed Netlify URL and verifies rendered browser behavior, network responses, calendar fallback behavior, and live fare rendering. Screenshots and JSON diagnostics are uploaded as workflow artifacts.

A backend smoke test or syntax check alone is not sufficient evidence that a UI behavior is fixed.
