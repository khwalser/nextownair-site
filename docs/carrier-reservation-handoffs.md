# Carrier reservation handoffs — November 21, 2026

## Current implementation
NexTownAir still queries **Duffel** for live offer inventory through `/api/flights`. Duffel's missing or empty nonstop response is not proof a published route stopped operating.

The itinerary now loads `carrier-booking.js`, which maps explicitly identified operating carriers or direction-specific published route carriers to a **verified official airline booking or reservations page**. A traveler opens the airline's site, enters the itinerary's airport pair and travel date, and completes the transaction with that airline.

These are **public handoff links, not an approved inventory API or affiliated reservation integration**. NexTownAir does not scrape a reservation system, generate bookings, transfer payment information, automatically prefill the external page or claim its own suggested fares are bookable.

## Official carrier entry points

| Carrier | Entry point | Method |
|---|---|---|
| Cape Air | https://www.capeair.com/book_flights/search-flights.html | Airline booking page |
| Southern Airways Express | https://www.iflysouthern.com/ | Airline booking page |
| Mokulele Airlines | https://www.mokuleleairlines.com/book-a-trip/ | Airline booking page |
| Denver Air Connection / Key Lime Air | https://denverairconnection.com/scheduled-flights/ | Airline booking page |
| Contour Airlines | https://www.contourairlines.com/ | Airline booking page |
| Alaska Seaplanes / Air Excursions | https://www.flyalaskaseaplanes.com/ | Airline booking page |
| Wright Air Service | https://wrightairservice.com/contact-us/ | Reservations contact |
| Bering Air | https://www.beringair.com/ | Airline booking page |
| Warbelow's Air Ventures | https://www.warbelows.com/home | Reservations contact |
| Taquan Air | https://taquanair.com/flights/ | Scheduled-flight booking page |
| Ryan Air (Alaska, **not** Ryanair) | https://ryanalaska.com/passenger/ | Airline booking page |
| Island Air Service (Kodiak) | https://www.flyadq.com/ | Airline booking page |
| United / United Express | https://www.united.com/en/us/book-flight/united-one-way | Airline booking page |
| American / American Eagle | https://www.aa.com/booking/search/find-flights | Airline booking page |
| Delta / Delta Connection | https://www.delta.com/flightsearch/book-a-flight | Airline booking page |
| Alaska Airlines | https://www.alaskaair.com/en/ | Airline booking page |

## Selection and trust
1. Prefer a carrier returned for a selected flight.
2. Otherwise use the carrier named in the directional `data.js` published service pattern, **as a suggestion, not a date-confirmed operator**.
3. If no source names the carrier, retain the generic flight-search option rather than assigning one.
4. Every external URL is owned by the fixed directory; no arbitrary URLs from provider data are inserted into booking actions.
5. Transfers remain non-flight itinerary legs and never display flight bookings.

`e2e/carrier-booking-regression.mjs` checks these names and safe URLs, and `e2e/carrier-booking-browser.mjs` tests the rendered itinerary handoff. The production workflow confirms identical deployed asset bytes before browser checks.

## What remains for truly integrated booking
An airline/booking-system API or GDS feed requires provider authorization, credentials, and relevant commercial permissions. Connecting these would allow date-specific availability and fares **inside NexTownAir**, subject to their terms and coverage. None is claimed implemented by the official-site handoffs. Multi-leg issuance and through-checking baggage require explicit ticketing agreements; independent airline bookings should not be represented as a single protected connection.
