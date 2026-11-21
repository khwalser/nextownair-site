# EAS schedule evidence review — November 21, 2026

## Scope and definitions

NexTownAir models 225 contracted EAS community–hub route pairs. The schedule coverage audit initially identified 28 pairs with published operating-day fallback patterns and **197 pairs without an equivalent verified day-level fallback**. The November 21 research pass added a time-bounded LEB–HPN pattern, bringing verified coverage to **29 of 225** and reducing the missing-day register to **196 pairs**. Contracted route existence is **not** proof that a particular flight operates on a particular date. See [the machine-readable 197-pair review register](../data/eas-schedule-evidence-gap.json).

The newly verified LEB–HPN directions have a bounded November 21–December 31, 2026 daily service window supported by [Lebanon Airport](https://lebanonnh.gov/158/Book-Your-Flight), [Cape Air future offers](https://flights.capeair.com/en/flights-from-lebanon-nh-to-white-plains-new-york), and [the published LEB–HPN timetable](https://zbordirect.com/en/tools/schedule/LEB/HPN). The pattern is not extended into 2027 without fresh evidence.\n\nEach register entry records its community, airport codes, modeled hub, geographic region, DOT source/index, and whether a future operating day has actually been confirmed. All 196 remaining entries remain `not_verified` for exact operating-day fallback; **none** is filled with an invented daily/weekly pattern.

Primary DOT references:
- [Current and historical EAS reports](https://www.transportation.gov/office-policy/aviation-policy/essential-air-service-reports)
- [May 2026 contiguous US, Hawaii and Puerto Rico report](https://www.transportation.gov/sites/dot.gov/files/May%202026%20EAS%20Report%2048_HI_PR.pdf)
- [Alaska report entry](https://www.transportation.gov/May%202026_Report_Alaska_PDF) — attachment table displays **May-25** in its heading; confirm current contractual orders before inferring date-specific service

## Three formerly flagged hubs

| Hub | Modeled onward link | Evidence | Interpretation |
| --- | --- | --- | --- |
| MKK (Molokai) | MKK–HNL, MKK–OGG | [Mokulele carrier site](https://www.mokuleleairlines.com/), [MKK actual departure board on November 21, 2026](https://www.flightstats.com/v2/flight-tracker/departures/MKK) | Nonstop flight links; no implied verified departure on every future date |
| HPN (Westchester) | HPN–ORD | [HPN–ORD current schedules](https://www.flightsfrom.com/HPN-ORD), [Google Flights route page](https://www.google.com/travel/flights/flights-from-westchester-county-to-chicago.html) | Current American nonstop link; future date subject to verification |
| MRI (Merrill Field) | MRI–ANC **ground transfer** | [Driving/rideshare route evidence](https://www.rome2rio.com/s/Anchorage-Airport-ANC/Anchorage-Merrill-Field-Airport-MRI), [Alaska DOT ANC ground transportation](https://dot.alaska.gov/anc/passengers-parking-transport.shtml) | Distinct Anchorage airports, **never** represented as a nonstop flight. The 45-minute planning allowance is a prototype, not a published end-to-end travel time |

All these additions have dedicated graph validation; the existing all-pairs audit continues to verify only declared flight and ground-transfer edges.

## Carrier timetable research leads

The [Alaska Seaplanes schedule/status page](https://www.flyalaskaseaplanes.com/flight-info/flight-schedule-status.html) contains weekday operating labels for AGN–JNU, ELV–JNU, KAE–JNU, PEC–JNU, TKE–JNU and GST–JNU. However, multiple seasonal schedules appear on the same page and not all sections provide unambiguous effective-year limits. These pairs are tagged `candidate_effective_period_unresolved`, **not** promoted to source-backed date patterns.

## Closure criteria

For an EAS route to move out of the missing-day list:
1. Capture an airline, airport or government source explicitly naming the airport pair and operating days, with valid effective-from and effective-through dates.
2. Determine directionality and intermediate stops: “via” service must not be presented as a nonstop flight.
3. Create directional service patterns with the original source URL and effective dates, never open-ended guesses.
4. Run the schedule coverage audit, direct-route tests, full 53,824-pair model routing audit and production browser regressions.
5. Keep a route **unknown** if the current timetable cannot be authenticated; live provider offers can still establish date-specific availability.

This work narrows the *evidence gap*, not the guarantees of live inventory. Every fare or actual scheduled flight remains subject to provider confirmation.
