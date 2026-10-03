# NexTownAir flight-data architecture

Status: implementation target after the 2026-10-03 network/provider audit.

## Problem

NexTownAir currently asks Duffel for nonstop offers and, when the published-schedule feed is unavailable, progressively scans calendar dates. The 40-case audit proved this is not a valid schedule strategy: only 14/40 representative cases returned live offers. Coverage was 6/12 Lower-48 EAS, 6/8 hub-to-hub, 1/15 Alaska EAS, and 1/5 regional probes.

An empty fare response therefore MUST NOT be interpreted as "no flight" or "invalid date." Fare inventory and published schedules are different facts.

## Source responsibilities

1. **Network source**: determines which airport pairs belong in the planning graph. Today this is the DOT EAS dataset plus explicitly verified connector edges. Future regional airports are added here independently of fare coverage.
2. **Schedule source(s)**: determines whether a flight is scheduled on a particular date and supplies operating times/carrier/flight number. This is the only source allowed to mark a calendar date as having no scheduled nonstop service.
3. **Fare source(s)**: prices a known scheduled flight/date when supported. Duffel is one fare provider, not the network or schedule authority.
4. **Booking source**: sends the traveler to a carrier or booking partner when direct fare inventory is unavailable.

## Required provider contract

Every provider adapter returns a normalized envelope:

- provider
- sourceType: network | schedule | fare | booking
- coverage: supported | unsupported | unknown
- checkedAt
- origin / destination / date
- flights[] for schedule adapters
- offers[] for fare adapters
- authoritativeForAbsence: boolean

Only a schedule response with authoritativeForAbsence=true may disable a date as "No scheduled nonstop."

## UI behavior

- Calendar dates remain selectable while schedule coverage is unknown.
- Never auto-scan an entire month through Duffel merely because the schedule source is unavailable.
- A selected date may request fare inventory, but "no fare returned" is shown exactly as that, not as "no flight."
- When schedule data confirms service but no fare provider covers it, show the flight and an external booking path rather than hiding the service.
- Provider failures are route/date-local and do not poison the rest of the session.

## Coverage tiers

- Tier A: schedule + live fare + booking path.
- Tier B: schedule + external booking path, no live fare.
- Tier C: verified network edge, schedule coverage unavailable. Keep selectable and clearly label verification pending.
- Tier D: unsupported/unverified edge. Do not route through it.

The product can span EAS, hubs, Alaska, and regional airports even when fare coverage differs; capability is attached to each leg rather than assumed globally.

## Acceptance gates

Before Karl is asked to test again:

- Browser E2E proves a fare-provider miss does not disable a date.
- Browser E2E proves schedule-confirmed service remains visible without a Duffel offer.
- Browser E2E covers Lower-48 EAS, hub-to-hub, Alaska, and regional-airport cases.
- Coverage audit reports schedule coverage separately from fare coverage.
- Calendar does not make serial full-month fare requests.
- A fresh deployed build passes the browser suite against the deployed URL.
