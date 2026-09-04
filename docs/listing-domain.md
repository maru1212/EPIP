# Listing Domain Layer (Task 6)

Companion to `docs/property-domain.md`. Records the decisions specific to
Listing — several deliberately mirror Property's Task 5 decisions for
consistency; differences are called out explicitly.

## 1. Enum casing: lowercase, not the spec's uppercase

The spec's examples used `RENT`/`SALE`/`DRAFT`/`ACTIVE`/etc. Every enum in
this schema so far (`UserStatus`, `PropertyCondition`,
`PropertyPublicationStatus`, `LocationLevel`, ...) is lowercase
snake_case. Used `rent`/`sale` and
`draft`/`active`/`sold`/`rented`/`expired`/`archived` for consistency —
not a correction of the spec's intent, just matching the established
convention.

## 2. Currency stays a plain string, not a Postgres enum

Already decided, before this task, in the Phase 1 review: *"Avoid
unnecessary complexity... use a future-friendly representation rather
than tightly coupling the database to only ETB/USD."* `Listing.currency`
is `VARCHAR(3) DEFAULT 'ETB'`, validated against a small Zod allow-list
(currently `ETB`/`USD`) at the application layer. Adding a currency later
is a one-line change to that allow-list, not a migration.

## 3. `price_per_sqm` stays computed, never stored

Also already decided, before this task: *"Do not store price_per_sqm as
an independently mutable field... treat it as a derived value."*
`calculatePricePerSqm` in `listingService.ts` is a pure function computing
it on demand from `Listing.price` and the associated `Property`'s
`buildingAreaSqm`/`landAreaSqm` — there is no stored column for it
anywhere, and there shouldn't be (a stored value could drift from the
price/area it was computed from).

**Design choice within that function**: building-area and land-area price-
per-sqm are computed *independently*, not one falling back to the other.
A property with both a building and a yard has two different, both-
meaningful figures; silently picking one would be wrong for some property
types. Missing or non-positive area is treated as "cannot be computed"
(`null`), never a divide-by-zero error or a negative/infinite result —
tested explicitly for zero, missing, and negative area.

## 4. Ownership vs. administrative override — same interim compromise as Property

Mirrors `docs/property-domain.md` §5 exactly: `Listing.agentUserId`
identifies who manages the commercial offer (distinct from
`Property.ownerUserId`, since the person listing a property professionally
isn't necessarily who created the Property record). `listingService`'s
`assertCanModify` allows the listing's own agent, or a caller passing
`canManageAnyListing` — which defaults to checking `user:manage`, the same
flagged, imperfect administrative-override proxy used for Property,
pending a dedicated permission (e.g. `listing:manage_any`).

## 5. Explicit status state machine, not free-form transitions

The spec asked for "soft-deactivation / status lifecycle transitions
(e.g. ACTIVE -> SOLD/ARCHIVED)" — implemented as an explicit, fixed
transition table (`ALLOWED_STATUS_TRANSITIONS` in `listingService.ts`)
rather than allowing any status to move to any other status. Concretely:
a `sold` listing can only move to `archived` (not back to `active` — that
would misrepresent a completed sale as available again); `archived` is
terminal (reactivating means creating a new listing, not un-archiving);
`rented` can return to `active` (a rental becoming available again is a
real, common case). An invalid transition returns `409 invalid_transition`
from the route, not a silent no-op or a generic error.

## 6. "Delete" -> archive, not `DELETE FROM listings`

Same principle as Property (Task 2's "prefer soft-deactivation over
destructive deletes," reaffirmed for Property in Task 5).
`DELETE /api/listings/[id]` calls `archiveListing`, which is a thin
wrapper delegating to `updateStatus(id, "archived", ...)` — archiving is
just another state transition, not a special-cased code path, so it goes
through the same ownership check and state-machine validation as any
other status change.

## 7. Combined price + spatial + property-attribute search

The literal Task 6 requirement — "price-range filtering combined with
spatial and location parameters from the underlying Property" — required
a genuine design decision: a `Listing`'s own columns can't express
location, size, or coordinates at all; those live on `Property`.
`listingRepository.search()` joins `listings l JOIN properties p ON p.id =
l.property_id` in one query, so price/type/status filters (Listing
columns) and location/size/spatial filters (Property columns) are applied
together, not as two separate queries reconciled in application code.
Verified against a live database with a case specifically designed to
fail if either half of the combination were ignored (a listing at the
right location but wrong price, and one at the right price but wrong
location, both correctly excluded).

Public search and public detail additionally require
`Property.publicationStatus = 'published'`, not just `Listing.status =
'active'` — a listing on an unpublished property isn't publicly visible
even if the listing itself is marked active, since the underlying
property record isn't meant to be seen yet.

## 8. Raw SQL throughout, even though Listing has no PostGIS column

Unlike `Property`, nothing about `Listing`'s own columns forces raw SQL —
a real generated Prisma Client could use `prisma.listing.create(...)`
directly. Raw SQL was used anyway, for a reason specific to this sandbox:
a schema-specific Prisma Client cannot be generated here (see
`prisma/README.md`), so ORM calls against the `any`-typed stub can't be
verified at all, not even by inspection. Raw SQL can still be verified by
running the equivalent statement directly against the live database
(every claim in `tests/integration/listingRepository.test.ts` was
verified this way before being written into the repository). This is
noted in `listingRepository.ts` itself as a "revisit once `prisma
generate` works normally" candidate, not a permanent architectural
position.

## 9. Defense-in-depth: a database-level CHECK constraint on price

`listings_price_positive CHECK (price > 0)` exists at the database level,
in addition to Zod's `.positive()` validation at the application layer.
Verified directly: an `INSERT` with a zero or negative price fails at the
database regardless of what validation layer it came through (or didn't
come through, e.g. a future direct-SQL migration or admin tool).

## 10. A pre-existing test fixed while verifying Task 6

Running the full suite (as Task 6's deliverables require) surfaced a
flaky assertion in Task 5's `property.test.ts`: "uses the GIST spatial
index" asserted the query planner would choose the index, but Postgres
correctly prefers a sequential scan over an index for a near-empty table
(every test cleans up its own fixtures, so `properties` is often at or
near zero rows when this test runs) — that's optimal planner behavior,
not evidence the index is missing. Fixed by forcing `enable_seqscan =
off` for the duration of the check (with an explicit reset afterward,
since `SET LOCAL` only scopes to a transaction and this connection isn't
wrapped in one), which robustly tests "the index exists and is usable,"
independent of current table size or statistics.
