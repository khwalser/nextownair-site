# NexTownAir MVP flight-data architecture

Status: implementation contract after the November 2026 MVP clarification.

## Product rule

NexTownAir presents feasible possibilities. It does not infer why a traveler is flying, whether a hub is merely a connection, whether shorter/cheaper/fewer legs is preferable, whether a trip must return to its origin, or whether a user-selected airport is more or less important than another.

User-selected route order is authoritative. NexTownAir may insert airports required to connect those selected points, but it does not reorder the selected points unless a future user-requested optimization mode explicitly asks it to.

## Network truth

The planning graph represents verified scheduled air service, not merely EAS community-to-designated-hub relationships. A service edge may be nonstop or a same-flight/through-service routing; that distinction is carried as service metadata rather than inferred from the EAS hub relationship.

1. DOT/EAS data establishes subsidized EAS community-to-hub service relationships.
2. Current airport, airline, or commercial schedule sources may establish additional real nonstop service from those airports. Source-audited additions are recorded in `routeVerification.additionalSmallAirportSources` so the graph does not collapse back to DOT hub-only relationships.
3. Major-airport connector service is represented by explicit verified edges. A pair is never inferred merely because both airports are called hubs.
4. Airport `type` is metadata. It does not control whether an airport may be selected, routed through, or treated as part of the trip.
5. The routing graph may be richer than the default map presentation. Map visibility and zoom policy are presentation concerns, not route-existence rules.
6. Current commercial hub-to-hub edges may live in a separate `backboneRoutes` layer. Routing uses both `routes` and `backboneRoutes`; the default map may omit backbone edges until map-density rules are deliberately designed.
7. A graph edge is not automatically synonymous with a nonstop flight. When a carrier timetable identifies an intermediate same-flight stop, the itinerary labels that through service explicitly instead of saying nonstop.

An airport automatically inserted by the routing engine is tracked explicitly as an auto-connector. The application must never infer that the user did not choose an airport merely because it is a hub.

Regional-network gaps remain visible until a current route or an explicit non-flight transfer model is verified. NexTownAir must not invent an airport-to-airport flight merely to collapse graph components. Disconnected components are an explicit allowlist in `routeVerification.unresolvedNetworkComponents`; the graph audit fails if any new or different disconnected set appears.

## Mixed-mode transfers

A real trip may require a local non-flight movement between two aviation facilities. Those movements are modeled separately in `transferEdges`; they are never inserted into the flight graph or presented as flights.

For MVP transfer segments:
- route finding may traverse a verified transfer edge;
- the itinerary renders the segment explicitly as a transfer;
- no airfare or flight-booking link is attached;
- a deterministic prototype duration may be used when a published end-to-end transfer time is unavailable, and it keeps the leading `?` prototype convention;
- flight counts, fare totals, and booking-checklist counts exclude transfer segments.

The first mixed-mode case is Ketchikan: Taquan's waterfront floatplane base (`WFB`) connects to Ketchikan International (`KTN`) through local ground travel plus the airport ferry. This is modeled as a transfer rather than an invented `WFB-KTN` flight.

## Flight existence, time, and fare are separate facts

A selectable flight/service must first be known to exist. NexTownAir does not prototype the existence of a flight.

For an existing service, individual fields may independently be verified or prototype values:

- `time_status: verified | prototype`
- `fare_status: verified | prototype`

Verified time example: `10:33a`

Prototype time example: `?10:33a`

Verified fare example: `$148`

Prototype fare example: `?148`

Prototype values use a distinct visual color and a single legend. The UI does not repeat a "Prototype fare" or "Prototype time" label on every card.

Prototype values are working MVP values. They participate in itinerary timing, downstream feasibility, and totals exactly like verified values, while retaining their provenance/status. Selected itinerary totals sum verified and prototype fares alike; if any included fare is prototype, the total is also displayed as a prototype value with the leading `?` convention.

Verified schedule fields are preserved independently of fare coverage. When a current schedule provider supplies exact departure/arrival times but the fare provider has no price, NexTownAir renders verified times normally and supplies only the fare as a `?prototype` value.

Route-specific published service patterns are not overwritten by an external schedule-provider outage. A provider failure can reduce field detail, but it cannot erase a service fact already established by a higher-confidence route source. Published service patterns also answer downstream date availability directly, so a provider outage cannot strand a known-service itinerary in a permanent “checking” state.

Sourced service patterns may include effective-date bounds, weekday rules, explicit no-service dates, and published departure/arrival times. Exact operating days are never inferred from ambiguous DOT frequency fields. When a current carrier timetable supplies exact times, those times are treated as verified schedule fields while fare gaps remain prototype values.

A timetable can be authoritative for operating days without being authoritative for a complete segment time. Wright Air's current timetable publishes Fairbanks departure times but explicitly says village departure times change daily and does not publish complete arrival times in the table. NexTownAir therefore uses those operating days to decide whether service exists on a date, while keeping the working itinerary times prototype rather than falsely marking them verified.

A source can be asymmetric. If a current carrier page publishes an exact outbound time but only the operating days for the return, NexTownAir may mark the outbound time verified while retaining a prototype return time. Field provenance follows what the source actually supports, not what would make the UI look more complete.

## Prototype-value fallback order

When a service is known to exist but a required field is unavailable, generate an MVP prototype value using this precedence:

1. deterministic route-based placeholder;
2. historical/typical value where legitimately available;
3. value derived from known service patterns.

The value remains `prototype` until current data verifies it.

## Provider responsibilities

The frontend consumes a provider-neutral NexTownAir flight contract rather than depending on a named vendor. The production browser endpoint is `/api/flights`, currently returning `contractVersion: nta-flights-v1`.

`flight-provider.js` owns browser-side flight and schedule request boundaries. Itinerary rendering consumes normalized data and must not parse provider-contract payloads, build provider URLs, or call provider-specific endpoints directly.

Provider adapters are responsible for:

- network/service existence;
- published schedule;
- fare;
- booking handoff.

Duffel may provide fares where supported. Other current or future providers may fill gaps. Provider adapters normalize into the `nta-flights-v1` boundary before data reaches itinerary rendering. A future paid comprehensive provider must be swappable behind that contract without rewriting the itinerary UI.

An empty fare response is never evidence that a flight does not exist.

## Dynamic itinerary

"Build Itinerary" creates the full route skeleton. The user sees the entire itinerary while making choices progressively.

Each upstream selection constrains every subsequent leg. When an earlier flight or stay changes, NexTownAir automatically:

1. recalculates all downstream feasibility;
2. removes options that are no longer feasible;
3. exposes newly feasible options;
4. preserves downstream selections that remain feasible;
5. invalidates downstream selections that no longer work.

These changes are silent and automatic. MVP does not use modal errors or dismiss prompts for normal downstream recalculation.

Stay duration is schedule-constrained in MVP: the chosen onward flight determines the effective stay.

## Booking boundary

MVP plans and organizes; external airlines/providers sell and service tickets.

A completed itinerary provides an ordered booking checklist with route, date, carrier/flight when known, time, fare, status/provenance treatment, and the best available external booking/search handoff.

NexTownAir does not take flight payment, issue tickets, service reservations, process cancellations/refunds, or otherwise operate as an OTA in the MVP.

## Deferred product areas

Deferred work includes saved/resumable/shareable trips, map/Your Trip synchronization, dynamic earliest-possible-end summary, map fare ranges, route optimization/filter modes, exact-stay preference search, fare history/confidence analytics, improved booking handoff, tool pricing/access model, and future flight-ticket commerce.

Saved trips, when implemented, are snapshots of user choices rather than frozen schedule/fare promises; they must be revalidated when reopened.

## Acceptance gates

Before the MVP is handed back for UAT:

- every DOT-listed EAS hub relationship is represented by a valid graph edge;
- graph audits identify isolated airports, invalid edges, duplicate edges, disconnected components, and connector continuity gaps across both map and commercial-backbone edges;
- known connector regressions such as Billings have a verified onward path;
- user-selected airports are never relabeled as automatic connectors based on airport type;
- only services known to exist are selectable;
- every selectable itinerary leg has a displayed fare (verified or prototype);
- prototype fields use the `?` convention and distinct prototype styling;
- an upstream change cascades through every downstream leg without modal error handling;
- the full route skeleton remains visible while choices change;
- external booking handoff is available for every completed leg;
- browser E2E runs against the actual production URL and captures evidence;
- desktop and mobile checks include horizontal overflow and above-the-fold itinerary usability.
