# Travelport onboarding for NexTownAir

Status: Transport implemented on an isolated feature branch, NOT connected to the production flight-offer endpoint. No Travelport credentials are provisioned on NexTownAir Netlify as of November 21, 2026.

Request TripServices v11 Flights Air Search trial credentials via https://developer.travelport.com/docs/getting-started or commercial onboarding at https://www.travelport.com/contact . Request GDS air search access, assigned access group/PCC, and documented EAS/regional carrier coverage.

Store credentials as Netlify secret environment variables scoped to Functions (do not paste them into GitHub or chat):

- TRAVELPORT_ENVIRONMENT = preproduction or production
- TRAVELPORT_USERNAME
- TRAVELPORT_PASSWORD
- TRAVELPORT_CLIENT_ID
- TRAVELPORT_CLIENT_SECRET
- TRAVELPORT_ACCESS_GROUP (preferred), or TRAVELPORT_PCC

The isolated server-side module netlify/lib/travelport-client.mjs provides credential validation, token caching, preproduction/production endpoints, an 18-second timeout, airport-only one-way GDS search, and raw response access. The regression e2e/travelport-client-regression.mjs only tests mocked requests. Raw results must NOT be displayed as normalized fare offers until live Flight and CatalogProductOffering references, currencies, prices, and nonstop legs are verified. No tickets are issued.

After approval, authenticate against pre-production, inspect real EAS responses, verify pricing and content permissions, implement nta-flights-v1 normalization, integrate with Duffel, run actual E2E and then deploy.

References: https://developer.travelport.com/docs/getting-started/authentication and https://developer.travelport.com/apis/flights/searches/createairsearch
