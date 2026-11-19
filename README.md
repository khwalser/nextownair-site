# NexTownAir

Map-first flight discovery and itinerary planning focused on Essential Air Service and other small-airport routes.

## Canonical deployment

- **Repository:** `khwalser/nextownair-site`
- **Production branch:** `main`
- **Netlify project:** `nextownair-site`
- **Custom domain:** `nextownair.com`
- **Hosting:** Netlify connected to GitHub
- **Current MVP data revision:** `2026-11-19.25`

## Product behavior

NexTownAir presents feasible travel possibilities rather than silently optimizing for cheapest, fastest, shortest, or fewest legs.

- User-selected airport order is authoritative.
- Hubs and non-hubs are all destinations to the user.
- NexTownAir inserts a connector only when routing requires it.
- The full itinerary skeleton remains visible while flights are chosen.
- Upstream flight/date changes re-evaluate all downstream legs.
- Feasible downstream selections are preserved; infeasible ones are silently invalidated.
- Completed trips provide an external booking checklist. NexTownAir does not ticket flights or take payment in the MVP.

See `docs/data-architecture.md` for the implementation contract.

## Flight data architecture

### Provider-neutral flight contract

The browser requests fares/offers through:

`/api/flights`

The contract is currently `nta-flights-v1`. The browser-side request and normalization boundary lives in `flight-provider.js`.

Duffel is currently one backend fare adapter, not a frontend dependency. The retired provider-specific browser proxy has been removed; fare traffic enters through the provider-neutral `/api/flights` boundary.

### Schedule availability

Published schedule availability is requested through the provider boundary in `flight-provider.js`, backed today by `/api/schedule-calendar` / AeroDataBox via API.Market where available.

Route-specific published service patterns are retained as service facts for known coverage-gap routes. A schedule-provider outage may reduce exact field detail, but it does not erase an already-established service relationship or leave downstream dates permanently stuck in “checking.”

### Verified vs prototype fields

Flight existence is never prototyped. Once service existence is established, individual fields may be:

- verified time, e.g. `10:33 AM`
- prototype time, e.g. `?10:33 AM`
- verified fare, e.g. `$148`
- prototype fare, e.g. `?148`

Prototype values are visibly distinguished and participate in itinerary feasibility and totals. If a selected itinerary total includes any prototype fare, the total itself is displayed with the leading `?` convention.

Prototype fallback precedence:

1. deterministic route-based placeholder
2. historical/typical value where legitimately available
3. value derived from known service patterns

## Route network

Routing uses two explicit edge layers:

- `routes`: the restrained/default map network
- `backboneRoutes`: verified commercial routing edges used by the planner but not necessarily drawn on the default national map

The routing engine uses both layers. Map scope and routing scope are intentionally separate.

Current graph state:

- 232 airports in the dataset
- 247 map-layer route edges
- 61 commercial backbone edges
- 1 explicit non-flight transfer edge
- all 232 airports currently participate in the connected travel graph

If a regional component becomes unresolved again, it must be listed explicitly in `routeVerification.unresolvedNetworkComponents`. CI fails if the actual disconnected set differs from that declaration. NexTownAir does not invent a flight edge merely to make the graph connected.

## Production validation

Rendered behavior is tested with Playwright through GitHub Actions:

- browser test: `e2e/live-itinerary.mjs`
- graph audit: `e2e/network-audit.mjs`
- workflow: `.github/workflows/live-e2e.yml`

The workflow:

1. audits the routing graph;
2. waits until `nextownair.com` exposes the exact `mvpRevision` from the test checkout;
3. runs the browser suite against the actual production domain;
4. uploads screenshots and diagnostics as evidence.

A preview deploy, backend smoke test, syntax check, or browser-text scrape alone is not sufficient evidence that a production UI behavior is working.

## Secrets

Netlify stores provider credentials as secrets, currently including:

- `DUFFEL_ACCESS_TOKEN`
- `AERODATABOX_API_MARKET_KEY`

Do not commit secrets to the repository.
