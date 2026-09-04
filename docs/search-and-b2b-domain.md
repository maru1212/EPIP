# Search, Public Analytics & B2B Scaffolding (Task 8)

Companion to `docs/property-domain.md`, `docs/listing-domain.md`, and
`docs/valuation-domain.md`.

## 1. Response standardization applies only to Task 8's new endpoints

Item 4 of the spec asks that "all public and B2B API responses follow a
consistent JSON structure." `src/lib/apiResponse.ts` implements exactly
that (`{ success: true, data, meta }` / `{ success: false, error }`) and
every new Task 8 route uses it. **It was not retrofitted onto Tasks 5-7's
existing routes** (`/api/properties`, `/api/listings`, `/api/valuations/*`),
which still return their original shapes (`{ property: ... }`,
`{ listing: ... }`, etc.) directly. Retrofitting those would be a large,
disruptive change to already-signed-off, tested response contracts, and
wasn't asked for. This is a real, acknowledged inconsistency in the API
surface today — flagged explicitly rather than silently left or silently
fixed by rewriting prior work.

## 2. `market_data:read` is new; no `institutional_client` role yet

The spec's alternative permission framing for the B2B endpoints —
"`market_data:read` or `valuation:create`" — has a problem: `valuation:
create` doesn't exist in this system, because Task 7 deliberately made
valuation *generation* public and rate-limited rather than
permission-gated. `market_data:read` was added as a genuinely new
permission (like `valuation:view` in Task 7 — no existing equivalent to
reuse) and granted to `market_researcher` and `platform_admin`.

**No dedicated `institutional_client` role was created.** The original
Phase 1 plan explicitly deferred institutional/B2B roles past launch, and
Task 8 frames this work as "scaffolding" — the goal here is a working
permission gate and functional endpoints, not full bank/MFI onboarding.
Real B2B access will need its own role (and likely its own onboarding
flow, API key strategy, etc.) as a future task.

## 3. Public estimate/analyze endpoints; gated B2B endpoints; no B2B rate limiting

- `GET /api/search/properties` — public, no permission gate (same
  reasoning as Property/Listing's public GETs), **not rate-limited**
  (consistent with that same precedent — it's a straightforward read).
- `POST /api/analytics/evaluate-listing` — public, but **strictly
  rate-limited** per the spec's explicit "protect against automated
  scraping" instruction, reusing the exact Postgres-backed limiter and
  config from Task 7's equivalent endpoint (this is effectively a
  superset/rebrand of that capability with two more input modes).
- Both B2B endpoints — gated behind `market_data:read`, **not**
  rate-limited. They're accessed by an authenticated, permissioned
  caller (institutional-style access), not anonymous traffic, matching
  how every other permission-gated mutation endpoint in this project is
  also not separately rate-limited — the permission check is the control
  here, not a request-volume throttle.

## 4. `evaluate-listing`'s three input modes, and why `propertyTypeId` was added

The spec's "propertyId or listingId, OR direct parameters (location,
buildingSize, askingPrice)" is implemented as three mutually-exclusive
modes (enforced by a Zod refinement — exactly one must be provided):

- **propertyId** — delegates to `valuationService.analyzeListingPrice`
  (Task 7), `askingPrice` required.
- **listingId** — new `analyzeListingById`: resolves the listing to its
  property, and uses the listing's own price as the asking price unless
  explicitly overridden.
- **direct parameters** — new `analyzeAdHoc`: analyzes a hypothetical
  property with no saved `Property` row at all, matching comparables by
  spatial proximity only (no `LocationNode` reference in this mode).
  **Requires `propertyTypeId`, added beyond the spec's literal field
  list.** Task 7's comparable-matching is built around "same property
  type" as a hard requirement — without it, this mode would either have
  to match across all property types (comparing an apartment to a
  warehouse) or silently degrade. Adding the field was the more honest
  option than either of those.

## 5. Neighborhood stats aggregate over the full LocationNode subtree

"Neighborhood stats for Bole" should include every neighborhood beneath
Bole in the hierarchy (`LocationNode.parentId`, established in Task 2),
not just properties tagged with that exact node — a subcity-level query
with zero results just because properties are tagged at the
neighborhood level beneath it would be a broken feature. Implemented via
`WITH RECURSIVE` to find the queried node and all its descendants, then
aggregating listings/properties across all of them. Verified against a
real three-level hierarchy (subcity -> two neighborhoods, each with its
own property/listing): querying the subcity correctly aggregates all
three; querying one leaf neighborhood alone correctly isolates just its
own property, not its sibling's or parent's.

`percentile_cont(0.5)` is used for a true SQL-computed median (over
pulling all rows into application code) — appropriate for what's meant to
be an efficient aggregate-stats endpoint.

## 6. "Historical range" is a current snapshot, not real history

No `PriceHistory` table exists yet (explicitly deferred since Task 6).
`NeighborhoodStats.priceRange` is the min/max of **currently active**
listing prices — a real, useful figure, but not a time-series history.
Documented explicitly in the repository/service code and here so this
isn't mistaken for tracking price movement over time.

## 7. `marketDataService`/`marketDataRepository` — a layering fix made mid-task

The first version of the neighborhood-stats logic put raw SQL directly in
`marketDataService.ts`, which — on review, while writing this doc — was a
genuine violation of the "routes -> services -> repositories -> database"
layering required throughout this project, and also meant the service
couldn't be unit-tested with a fake (only verified via a live-database
integration test). Split into `marketDataRepository.ts` (the SQL) and a
thin `marketDataService.ts` (composition, following the same DI factory
pattern as every other service in this codebase). Caught and fixed before
this was delivered, not left as a known issue.

## 8. `listingRepository.searchWithPropertyDetails` — new method, not a breaking change

Task 8's aggregated search needs full Property fields (coordinates, area,
bedrooms/bathrooms, condition) in the response, not just filtering by
them — Task 6's existing `search()` only returns `Listing` fields. Added
a new method reusing a shared, extracted WHERE-clause builder (so the two
methods' filtering logic can't drift apart), rather than changing
`search()`'s existing return shape and risking every consumer of Task 6's
already-shipped contract.

## 9. `src/modules/search/` — filled in as originally scoped back in Task 1

This module was scaffolded in Task 1 specifically for "combined
filter/geo query building over Property and Listing." Task 8 is the
first task to give it real content (`searchService.ts`,
`marketDataService.ts`, `marketDataRepository.ts`) — not a new,
unplanned module.
