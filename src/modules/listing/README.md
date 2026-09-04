# listing module

Commercial offers/advertisements against a Property.

Implemented (Task 6): `Listing` schema (price, currency, status
lifecycle, agent ownership), a full repository
(`repositories/listingRepository.ts` — CRUD, status transitions, and
combined price+spatial+property-attribute search via a join to
`properties`), and a service layer (`services/listingService.ts` —
ownership-vs-admin authorization, an explicit status state machine, and
price-per-sqm calculation). See `docs/listing-domain.md` for decisions and
flagged trade-offs. No PriceHistory or duplicate-detection matching yet —
those are later tasks.
