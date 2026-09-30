# NexTownAir

Map-first flight discovery prototype focused on Essential Air Service and other small-airport routes.

## Current app

- **Map:** choose airports, add/remove stops, reorder the route, and build round trips.
- **Itinerary:** choose layover/stay duration and select up to one sample flight per leg.
- **State:** route and itinerary choices persist between the map and itinerary views.
- **Netlify function:** `netlify/functions/flight-proxy.js` is the only flight-proxy implementation kept in the repo.

## Canonical deployment

Netlify project: `regal-parfait-b8ba1d`

Custom domain: `nextownair.com`

Production branch: `main`

## Data mode

The UI currently uses deterministic sample schedules and fares so the full interaction works without a live flight API. Live data can be layered in later through the provider/function architecture.
