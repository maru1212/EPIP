# property module

Canonical physical property records (the real-world asset).

Implemented (Task 5): `PropertyType`/`Property` schema (incl. PostGIS
coordinates, ownership, and publication-lifecycle status), a full
repository (`repositories/propertyRepository.ts` — CRUD, filtered/spatial
search, status/coordinate updates), and a service layer
(`services/propertyService.ts` — ownership-vs-admin authorization
composing with RBAC). See `docs/property-domain.md` for decisions and
flagged trade-offs. No Listing/PriceHistory/valuation yet — those are
later tasks.
