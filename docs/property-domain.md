# Property Domain Layer (Task 5)

This document records the decisions and trade-offs from expanding
Property into a full repository/service/route layer, several of which
required resolving a real tension between the literal Task 5 spec and
this project's established architecture. Per explicit instruction to
"adhere strictly to established architecture and boundaries," the
established boundaries won every time they conflicted with the literal
spec — each case is documented below rather than silently decided.

## 1. No price-range filtering

The spec asked for filtering by "price ranges." `Property` has no price
field, by design: price is a commercial-offer concept that belongs on
`Listing` (Phase 1 review's Property/Listing split — a canonical property
can have zero, one, or many listings at different prices from different
sources, which is the entire point of keeping the two separate). Adding a
price field to `Property` to satisfy this literally would break that
boundary for the sake of one task's filter list. **Not implemented.**
Location, property type, bedroom count, and land/building area filtering
are all implemented, since those genuinely are Property-level fields.

## 2. `property:read` → `property:view`

The spec named a `property:read` permission. The actual, canonical,
seeded permission (single source of truth in
`modules/identity/permissions.ts`) is `property:view`. Since
`PermissionKey` is a strict TypeScript union derived from that source,
using `"property:read"` literally fails to compile — used `property:view`
instead rather than adding a duplicate/inconsistent permission.

## 3. Public read access

The original permission matrix (Phase 0/1) makes property viewing public,
Guest included — no login required. `GET /api/properties` and
`GET /api/properties/[id]` have no `requirePermission` gate; only
`POST`/`PATCH`/`DELETE` and the status-transition `PATCH` are gated.
Gating GET would return 401 to anonymous visitors just for browsing,
contradicting that requirement. Both public GET endpoints only ever
return `published` properties, regardless of who's asking — there's no
session on a public route to distinguish an owner from a stranger, so a
draft is treated as not-found rather than "exists but forbidden" (which
would confirm its existence to someone with no right to know).

## 4. "Delete" → archive, not `DELETE FROM properties`

Per this project's established "prefer soft-deactivation over destructive
deletes" principle (Task 2), `DELETE /api/properties/[id]` sets
`publicationStatus` to `archived` rather than removing the row. Still
gated behind `property:delete` — the permission name describes the
authorization level required, not the literal SQL operation performed.

## 5. Ownership vs. administrative override — a flagged, imperfect compromise

The spec asks for `property:update`/`property:delete` to cover "both
administrative and owner operations" — implying a plain agent/seller
should only be able to modify properties they own, while an admin should
be able to modify any property. The RBAC permission system as it exists
today has no way to express that distinction: everyone holding
`property:update` (seller, agent, agency_admin, platform_admin, per the
Task 2 seed data) holds it unconditionally, with no separate "own" vs.
"any" grant.

**What was built:** `Property` now has `ownerUserId` (set automatically
from the authenticated caller at creation — never trusted from client
input, to prevent assigning ownership to someone else).
`propertyService`'s `assertCanModify` allows an action when the caller
owns the property, or when the property has no recorded owner (e.g.
legacy/admin-entered data), or when the caller passes a
`canManageAnyProperty` check — which **defaults to checking `user:manage`**
as an interim administrative-override signal.

**Why this is flagged as a compromise, not a clean design:** `user:manage`
is about managing user accounts, not properties. Using it here works
correctly *in effect*, only because `platform_admin` is currently the
sole role holding it in the seed data — but the permission's name doesn't
describe what it's being used for, and if a future role were ever granted
`user:manage` without being intended to have property override rights (or
vice versa), this coupling would silently misbehave. **The correct fix**
is a dedicated permission (e.g. `property:manage_any`), which is a genuine
schema/seed change belonging to a future task, not this one. This function
is intentionally injectable (`createPropertyService(repository,
canManageAnyProperty)`) specifically so swapping in a real permission
check later is a one-line change at the call site, not a rewrite.

## 6. `withPermission.ts` bug found and fixed during this task

`requirePermission`'s wrapped handler only ever forwarded the `Request`
object, silently dropping any additional arguments. Next.js always calls
a dynamic route's handler as `handler(request, { params })` — so any
RBAC-gated dynamic route (exactly what `/api/properties/[id]` needed)
would have received `params: undefined` at runtime, with no compile-time
or obvious runtime signal that anything was wrong until someone tried to
read `params.id`. This had been latent since Task 4 (the only route
guarded until now, `/api/admin/ping`, has no dynamic segments, so the bug
never manifested). Fixed by making the guard generic over any extra
arguments and forwarding them through — verified both by a dedicated test
(`properties-route.test.ts`, "passes the route's [id] param through
correctly") and by every other route test still passing unchanged.

## 7. Spatial query design

Unchanged from the original Task 5 pass: `Property.coordinates` is
`geography(Point, 4326)`, specifically (not `geometry`) so
`ST_DWithin(a, b, meters)` interprets its distance argument in real-world
meters. All spatial SQL (`ST_SetSRID`, `ST_MakePoint`, `ST_DWithin`,
`ST_Distance`) is raw SQL via `$queryRaw`/`$queryRawUnsafe`, since
`coordinates` is declared `Unsupported` in `schema.prisma` — Prisma has no
native geography type. The GIST spatial index
(`properties_coordinates_gist_idx`) was re-verified live and its use by
the query planner was confirmed via `EXPLAIN` in the original Task 5 pass;
this expansion doesn't change the column or index, only adds more query
shapes against it.

## 8. Dynamic SQL construction — safety notes

`search()` and `updateDetails()` build SQL with a variable number of
conditions/columns. Every **value** is still a parameterized argument
($1, $2, ...) — never string-interpolated. Only column **names** are
concatenated into the SQL text, and those always come from a fixed
whitelist (`UPDATABLE_COLUMNS` for updates; a small fixed set of named
conditions in `search`), never from caller-supplied strings. This is the
standard safe pattern for dynamic SQL when the ORM's own fragment-
composition helpers (`Prisma.sql`) aren't reliably typed against the
un-generated client in this environment (see `prisma/README.md`).
