# Architecture

## Modular monolith

EPIP is a single deployable Next.js application, not a set of microservices.
At this stage the domain is well understood but data volume and team size
don't justify network-hop overhead between services. A monolith with clean
internal boundaries gets most of the maintainability benefit of
microservices without the operational cost of running and securing many
services.

## Domain-based module organization

Code is organized by business domain, not by technical layer. Each module
under `src/modules/` owns its own slice of the domain:

```
src/modules/
  identity/       users, roles, permissions, RBAC policy
  location/       Ethiopian location hierarchy
  property/       canonical physical property records
  listing/        commercial offers against a property, sources, price history
  search/         combined filter/geo query building
  media/          property and listing image access
  engagement/     favorites, inquiries, leads
  data-quality/   verification status, provenance, scoring inputs
  audit/          audit logging for sensitive actions
```

Each module has (or will have, as it's implemented) two sub-directories:

- `services/` — framework-agnostic domain logic. This is where business
  rules live: what it means to create a property, what happens when a
  listing's price changes, how permissions are checked. Services don't know
  about HTTP, Next.js, or the request/response cycle.
- `repositories/` — data access. This is the only layer allowed to talk to
  Prisma/the database directly. Services call repositories; nothing else
  does.

This split is what keeps the codebase testable without spinning up a
server, and what makes it possible to extract a module into its own service
later without a rewrite — the module's public interface (its services)
would simply be called over the network instead of in-process.

## Thin Next.js route handlers

Route handlers under `src/app/api/**` are intentionally kept thin: parse
and validate the request (typically with Zod), call the relevant module
service, shape the response. No business logic should live in a route
handler. This keeps the HTTP layer replaceable and keeps business logic
testable independent of Next.js.

## Service layer responsibility

Services implement use cases: "create a property," "change a listing's
status," "check whether a user can edit this resource." They orchestrate
calls to one or more repositories, enforce business rules and invariants,
and are the boundary other code (route handlers, background jobs, future
CLI scripts) is expected to call through.

## Repository/data-access responsibility

Repositories are responsible for translating between the domain and the
database. They contain queries (via Prisma, or raw SQL for PostGIS and
analytics-heavy queries where Prisma isn't a good fit) and nothing else —
no business rules, no validation beyond what the database itself enforces.

## Future extraction into separate services

Because modules only depend on each other through their `services/`
interfaces (never by reaching into another module's repository or
internals), a module that outgrows the monolith — most likely `search` or a
future `valuation` module doing heavy computation — can be pulled out into
its own deployable service later. The call site changes from an in-process
function call to a network call; the calling code's shape does not need to
change significantly.

## What's introduced in later tasks

To keep this codebase scoped correctly, the following are deliberately
**not** part of it yet:

- **PriceHistory, PropertySource, and duplicate-detection matching** —
  `Listing` (Task 6) has the `propertyId` foreign key structure that
  supports "many listings, one canonical property," but no price-change
  history table or cross-source duplicate-matching logic exists yet.
  Task 8's B2B "historical range" is a current-snapshot approximation
  for this same reason — see `docs/search-and-b2b-domain.md` §6.
- **A dedicated `institutional_client` role and real B2B onboarding** —
  Task 8's B2B endpoints are explicitly scoped as "scaffolding": gated
  behind a real permission (`market_data:read`), but granted to existing
  internal roles (`market_researcher`/`platform_admin`) rather than a
  purpose-built institutional role, API key strategy, or onboarding
  flow, none of which exist yet.
- **Consistent API response structure across the whole API surface** —
  Task 8's new endpoints use a standardized `{ success, data, meta }` /
  `{ success, error }` envelope (`src/lib/apiResponse.ts`), but Tasks
  5-7's existing routes were not retrofitted to match — a real,
  acknowledged inconsistency, not an oversight. See
  `docs/search-and-b2b-domain.md` §1.
- **Resource-level (ownership) authorization as a designed permission** —
  `can()` answers "does this user's role grant them this permission at
  all." Property, Listing, and Valuation each compose an *additional*,
  service-level ownership check on top of that (see the respective
  sections below) — but that check currently uses `user:manage` as an
  interim, flagged proxy for "administrative override," not a
  purpose-built permission. See `docs/property-domain.md` §5,
  `docs/listing-domain.md` §4, and `docs/valuation-domain.md` §2.
- **A real AI-model integration for valuation** — `ValuationReport.
  rawAiResponse` exists on the schema for this, but Task 7's engine is
  purely statistical (comparable sales, no model call). An interchangeable
  AI provider abstraction (Gemini or otherwise) is introduced only once
  that integration is actually being built.
- **Cost-approach/hybrid valuation methodology, professional/manual
  valuer workflows, and rental-value estimation** — `ValuationReport.
  methodology` has enum values for `cost_approach`/`hybrid` and
  `Listing.listingType` already distinguishes rent from sale, but only
  `comparable_sales` against sale listings is implemented.
- **Data ingestion / scraping** — explicitly out of scope for the
  foreseeable future per product direction; no ingestion code, scheduled
  jobs, or scraping utilities exist in this repository.

## Property (Task 5)

`PropertyType` (table-driven, like Role/Permission) and `Property` — the
canonical physical-asset record, per the Phase 1 review's Property/Listing
split. **No price field exists on `Property`, deliberately** — price is a
commercial-offer concept that belongs on `Listing` (not built yet); Task
5's spec asked for price-range filtering, which isn't implemented for
exactly this reason (see `docs/property-domain.md` for the full
reasoning). `publicationStatus` (draft/published/archived) is a separate
axis from a future Listing's commercial status — it's the visibility
lifecycle of the canonical record itself, not an offer's state.

- `src/modules/property/repositories/propertyRepository.ts` — the only
  place that talks to the database for property data: `create`,
  `findById`, `search` (location/type/size/bedroom filters, optional
  spatial `near` filter), `updateDetails`, `updateCoordinates`,
  `updatePublicationStatus`, plus the original `findWithinRadius`. All
  raw SQL (parameterized; column names come from fixed whitelists, never
  caller input) — one query style for the whole table, consistent since
  `coordinates` already requires raw SQL and mixing ORM/raw-SQL styles
  for the same table adds more confusion than it saves.
- `src/modules/property/services/propertyService.ts` — business logic:
  ownership is always taken from the authenticated caller, never client
  input; resource-level authorization (does this user own THIS property,
  or hold an administrative override) composes with the route-level RBAC
  permission check, per the pattern anticipated in the Task 4 audit.
  "Delete" archives (`publicationStatus: "archived"`) rather than issuing
  a real SQL `DELETE`, per this project's soft-deactivation principle.
- `src/app/api/properties/route.ts` (list/search — public; create — gated
  behind `property:create`), `src/app/api/properties/[id]/route.ts`
  (detail — public; update — gated behind `property:update`; delete/
  archive — gated behind `property:delete`), `src/app/api/properties/
  [id]/status/route.ts` (publication-status transitions — gated behind
  `property:update`). GET routes are intentionally public — gating them
  would 401 unauthenticated browsing, contradicting the original
  permission matrix's "Guest can view" requirement.
- `Property.coordinates` is a PostGIS `geography(Point, 4326)` column,
  `Unsupported` in schema.prisma (Prisma has no native geography type) —
  every read/write goes through `$queryRaw`/`$queryRawUnsafe`, never the
  normal Prisma Client API for that one column. See `prisma/README.md`
  for why `geography` (not `geometry`, unlike `LocationNode.boundary`) was
  used specifically for this column.
- Data-quality fields (`completeness_score`, `location_accuracy`,
  `verification_status`, `last_verified_at`) exist on the schema now,
  unused/unscored, per the same "architecture before algorithm" principle
  established in Task 2 for the identity/RBAC data-quality fields.

See `docs/property-domain.md` for the full set of decisions and flagged
trade-offs from this task, including the interim, imperfect
"administrative override" check (`user:manage` as a proxy — there is no
dedicated `property:manage_any` permission yet).

## Listing (Task 6)

`Listing` — a commercial offer against a `Property` (Phase 1 review's
Property/Listing split, now fully realized): a canonical `Property` can
have zero, one, or many `Listing`s. Price, currency, negotiability, and
commercial status live here, never on `Property`.

- `src/modules/listing/repositories/listingRepository.ts` — CRUD, status
  updates, and `search()`, which joins `properties` so a single query can
  combine Listing-level filters (price, type, status) with Property-level
  filters (location, size, spatial proximity) — the literal "price range
  AND location/spatial parameters simultaneously" requirement.
- `src/modules/listing/services/listingService.ts` — ownership
  authorization (same pattern as `propertyService`), an explicit status
  state machine (not every status can transition to every other one —
  see `docs/listing-domain.md` §5), and `calculatePricePerSqm`, a pure
  function (independently unit-tested) computing price-per-sqm on demand
  from a listing's price and its property's area — never stored, per the
  Phase 1 review's explicit prior guidance not to persist a derived value.
- `src/app/api/listings/route.ts` (list/search — public; create — gated
  behind `listing:create`), `src/app/api/listings/[id]/route.ts` (detail —
  public, includes computed `pricePerSqm`; update — gated behind
  `listing:update`; archive — gated behind `listing:delete`),
  `src/app/api/listings/[id]/status/route.ts` (status transitions — gated
  behind `listing:update`). Same public-GET/gated-mutation pattern as
  Property, for the same reason (the original permission matrix makes
  browsing public).
- `Listing.currency` is a plain, Zod-validated string, not a Postgres
  enum — an explicit prior decision (Phase 1 review), not new to this
  task. `Listing.price` has both Zod validation and a database-level
  `CHECK (price > 0)` constraint (defense in depth).

See `docs/listing-domain.md` for the full set of decisions, including the
same interim `user:manage`-as-admin-override compromise used for Property.

## Valuation (Task 7)

`ValuationReport` — an automated market valuation for a `Property`,
computed from comparable active sale listings via a purely statistical
engine (no AI model call yet — `rawAiResponse` exists on the schema for
that future work, unused today).

- `src/modules/valuation/services/valuationMath.ts` — the actual math,
  as pure functions with no database dependency: `computeValuationEstimate`
  (median/average price-per-sqm, a condition multiplier, and a
  sample-size-and-variance-driven confidence score and price range) and
  `analyzeAskingPrice` (the overpriced/fairly-priced/underpriced
  classifier). Explicitly an uncalibrated v0 heuristic, not a production
  AVM — see `docs/valuation-domain.md` §4.
- `src/modules/valuation/repositories/valuationRepository.ts` —
  comparable retrieval (same property type; same LocationNode OR within a
  radius; sale listings only; published properties only) via a join to
  `properties`/`listings`, plus `ValuationReport` CRUD.
- `src/modules/valuation/services/valuationService.ts` — orchestrates
  rate limiting (reusing the Task 3.1 Postgres-backed limiter — no new
  infrastructure), which area field to value by (building preferred, land
  fallback), and report-ownership enforcement.
- `src/app/api/valuations/estimate/route.ts` and
  `.../analyze-listing/route.ts` — public, rate-limited, not
  permission-gated (the spec's own "public freemium access" framing, and
  `ValuationReport.requestedByUserId` being nullable in the schema).
  `src/app/api/valuations/[id]/route.ts` — gated behind the new
  `valuation:view` permission, unlike Property/Listing's public GETs; a
  saved report is closer to a personal query result than a public
  listing.
- **Zero comparables never produces a fabricated price.** With no real
  market data, the engine returns an explicit "insufficient data" result
  (confidence effectively 0, nothing persisted) rather than inventing a
  placeholder number — a considered interpretation of the spec's "return
  a baseline fallback," flagged explicitly in `docs/valuation-domain.md`
  §1 since a literal reading could mean fabricating a number instead.

See `docs/valuation-domain.md` for the complete set of decisions.

## Search, Public Analytics & B2B Scaffolding (Task 8)

Aggregated discovery search, a public rate-limited "overpriced?" widget
with three input modes, and B2B market-data scaffolding — filling in the
`search` module that was placeholder-scaffolded back in Task 1.

- `src/lib/apiResponse.ts` — the standardized `{ success, data, meta }` /
  `{ success, error }` envelope, used by every Task 8 route. **Not**
  retrofitted onto Tasks 5-7's existing routes — a real, acknowledged
  API-surface inconsistency, flagged in `docs/search-and-b2b-domain.md`
  §1 rather than silently left or silently fixed by rewriting signed-off
  work.
- `src/modules/search/services/searchService.ts` — composes
  `listingRepository.searchWithPropertyDetails` (a new method, Property
  fields alongside Listing fields in one row) with `listingService`'s
  `calculatePricePerSqm`, for `GET /api/search/properties`.
- `src/modules/search/repositories/marketDataRepository.ts` +
  `services/marketDataService.ts` — B2B neighborhood-stats aggregation.
  Uses a recursive CTE so querying a subcity includes every neighborhood
  beneath it (verified against a real three-level hierarchy), and SQL
  `percentile_cont` for a true median. Split into repository/service
  layers after an initial version mixed raw SQL directly into the
  service — a layering violation caught and fixed mid-task, see
  `docs/search-and-b2b-domain.md` §7.
- `valuationService` extended with `analyzeListingById` (resolves a
  Listing to its Property/price) and `analyzeAdHoc` (a hypothetical
  property with no saved `Property` row, spatial-only comparable
  matching) — the three input modes `POST /api/analytics/evaluate-listing`
  needs. `analyzeAdHoc` requires `propertyTypeId`, added beyond the
  spec's literal field list, since comparable-matching is built around
  "same property type" as a hard requirement.
- `market_data:read` — a genuinely new permission (no
  `institutional_client` role exists yet; granted to `market_researcher`/
  `platform_admin` for now, consistent with this being explicitly-scoped
  "scaffolding," not full B2B onboarding) gates both B2B endpoints.
  `GET /api/search/properties` stays public/ungated/unrate-limited,
  matching Property/Listing's existing public-GET precedent;
  `POST /api/analytics/evaluate-listing` is public but strictly
  rate-limited (reusing Task 7's Postgres-backed limiter), per the
  spec's explicit anti-scraping requirement.

See `docs/search-and-b2b-domain.md` for the complete set of decisions.

## API Standardization, OpenAPI Specs & Integration Polish (Task 9)

Retrofitted Tasks 5-7's routes to Task 8's standardized envelope, added a
universal error boundary sanitizing unexpected/Prisma errors, and
published a complete OpenAPI 3.0 spec with interactive docs.

- `src/lib/errorBoundary.ts` — `handleUnexpectedError`, the shared
  catch-all every route's final `catch` block calls instead of
  `throw error`. Duck-types Prisma's known-request-error shape (`{name,
  code, clientVersion}`) rather than using `instanceof
  Prisma.PrismaClientKnownRequestError`, which is `undefined` at runtime
  in this sandbox's un-generated client stub — confirmed by direct
  testing, not assumed. Maps P2002/P2025/P2003 to
  409/404/409 respectively; everything else, Prisma or not, becomes a
  single generic sanitized 500. Always logs the real error server-side
  first.
- Every route in `/api/properties/*`, `/api/listings/*`, and
  `/api/valuations/*` (including `analyze-listing`, not just the
  spec's literally-named `estimate`) now uses `src/lib/apiResponse.ts`'s
  `successResponse`/`errorResponse`, matching Task 8's endpoints.
- `src/lib/withPermission.ts` — the shared RBAC guard behind every gated
  route in the app — was also retrofitted, even though not in the
  spec's literal route list: its 401/403 responses are the single most
  common error case across the whole API, so standardizing individual
  routes without it would have left that case inconsistent. See
  `docs/api-standardization.md` §1.
- `src/lib/openapi/spec.ts` — a code-first OpenAPI 3.0 document covering
  every real route/method/parameter/status code in the application,
  served raw (not enveloped — a deliberate, standard exception) at
  `GET /api/openapi.json`, with an interactive Swagger UI (loaded from a
  CDN, no new npm dependency) at `GET /api/docs`. Documents protected
  endpoints as requiring "Bearer JWT," per the spec's explicit framing —
  flagged in the spec file itself and in `docs/api-standardization.md`
  §7 as a simplification, since this API's real mechanism is an httpOnly
  session cookie, not a client-presented header.

See `docs/api-standardization.md` for the complete set of decisions.

## AI-Powered Valuation Intelligence & Narrative AVM Reports (Task 10)

Enriches the statistical valuation engine (Task 7) with an optional,
resilient AI-generated narrative layer — never replacing or
recalculating the statistics, only explaining them in plain language.

- `src/modules/valuation/services/aiProviders/` — the adapter pattern:
  `aiProvider.ts` (interface), `mockAIProvider.ts` (the default; real,
  deterministic, data-driven narrative generation with zero external
  calls or API key — this is what makes the feature and this project's
  test suite work with no AI configured at all), `anthropicAIProvider.ts`
  (a real, correct HTTP implementation against Anthropic's Messages API,
  honestly flagged as untestable end-to-end in this sandbox — no API key
  configured), `createAIProvider.ts` (factory, defaults to mock whenever
  no real provider is configured), `prompt.ts` (shared prompt builder
  with Ethiopian market context, explicitly framed as general public
  knowledge, not proprietary data this platform doesn't have).
- `src/modules/valuation/services/aiValuationService.ts` — orchestrates:
  runs the existing, unmodified `valuationService.estimateValue` for the
  statistical baseline, then attempts AI enrichment with a hard
  service-level timeout independent of whatever a specific provider does
  internally. Any failure — provider error, timeout, malformed response
  — falls back to the already-successful statistical report with
  `aiEnriched: false`, never a thrown error. Reuses `valuationService.
  getReport`'s existing, tested ownership check for the AI-summary
  lookup rather than duplicating it.
- `valuationRepository.updateAiEnrichment` — merges the narrative into
  the existing `valuationData` JSONB via Postgres's `||` operator (not an
  overwrite) — verified against a live database that the original
  statistical fields survive enrichment, including a second, later
  re-enrichment.
- `POST /api/valuations/ai-report` (gated: the new `valuation:create`
  permission, distinct from the deliberately-public statistical
  estimate) and `GET /api/valuations/[id]/ai-summary` (gated:
  `valuation:view`, same as the underlying report) — both using Task 9's
  standardized envelope.

See `docs/ai-valuation-domain.md` for the complete set of decisions,
including a newly-discovered `npm` tooling issue found and properly
fixed (not routed around) during this task's verification.

## Public Property Discovery Portal, Interactive Maps & Valuation UI (Task 11)

The first frontend built on top of the API surface established across
Tasks 5-10 — a public search/discovery portal, an interactive map, and
the overpriced-price evaluator as embeddable UI, layered
`components/ui -> components/features -> lib/api -> app`.

- `src/lib/api/client.ts` + `types.ts` — type-safe wrapper unwrapping the
  Task 9 standardized envelope, with `ApiClientError` distinguishing
  network failures from server-rejected requests. `src/lib/api/
  queryProvider.tsx` wires React Query into the root layout for
  caching/revalidation.
- `GET /api/locations` and `GET /api/property-types` — two small, new,
  necessary backend endpoints. `LocationNode`/`PropertyType` are
  table-driven (Task 2/5), so the frontend had no static list to fall
  back on for its dropdowns without these.
- `src/components/search/` — `SearchFilters` (location, property type,
  listing type, price/bedroom/bathroom filters), `PropertyCard`,
  `ViewToggle` (grid vs. split map/list).
- `src/components/map/PropertyMap.tsx` — Leaflet + OpenStreetMap (no API
  key required, unlike Mapbox), with debounced bounds-based re-search.
  The pure bounds-to-radius math lives in `mapBounds.ts`, separated out
  so it's unit-testable without a DOM/map instance — the search API only
  supports radius search, so a true rectangular bounding-box query is
  approximated as a circle reaching the visible area's farthest corner.
- `src/components/analytics/OverpricedEvaluatorWidget.tsx` — resolves a
  real mismatch between the spec's "subcity dropdown" UI and the
  backend's actual requirement (precise lat/lng + a property type) via
  `LocationNode.boundary`'s centroid — flagged as depending on real
  boundary data that isn't seeded anywhere in this project yet.
- `src/app/properties/page.tsx` — composes all of the above; the map is
  loaded via `next/dynamic({ ssr: false })` since Leaflet requires
  browser globals unavailable during server render.

See `docs/frontend-portal.md` for the complete set of decisions.

## B2B Banking & Valuer Intelligence Portal UI (Task 12)

Institutional-facing pages under `/b2b/*`, gated by the RBAC permissions
already established in Tasks 8/10 (`market_data:read`, `valuation:view`,
`valuation:create`) — enforced by the backend, interpreted (not
re-implemented) by the frontend.

- Two backend extensions, made because the UI genuinely had nothing to
  render otherwise: `marketDataRepository.getCategoryBreakdown`
  (Residential/Commercial/Land price/m², grouped via a `CASE` over
  `property_types.key` — verified against real mixed-category data) and
  `valuationService.estimateValue` now persisting a `comparables` array
  (address, size, price, price/m², distance) into `valuationData`,
  instead of just bare comparable IDs. `NeighborhoodStats.
  trendDirection` is always `"unavailable"` — no fabricated historical
  trend, since no `PriceHistory` data exists.
- `src/components/b2b/` — `UnauthorizedFallback` (shared 401/403 UI,
  used by all three pages), `MetricCard`, `ConfidenceGauge`,
  `CategoryBreakdownTable`, `ComparablesTable`, `NarrativeSection`.
- `src/app/b2b/market-data/page.tsx` — the neighborhood analytics
  dashboard, consuming `GET /api/v1/b2b/market-data/neighborhood-stats`.
- `src/app/b2b/valuations/[id]/page.tsx` — the report viewer, consuming
  `GET /api/valuations/[id]` and `GET /api/valuations/[id]/ai-summary`
  together.
- `src/app/b2b/valuations/new/page.tsx` — the collateral valuation
  request form. Its "manual details" mode creates a draft `Property` via
  the existing `POST /api/properties` first, then values it — no backend
  endpoint accepts raw manual details directly, so this reuses real
  infrastructure rather than adding a new one. This means that path
  needs `property:create` in addition to `valuation:create`, flagged
  explicitly in the form's own copy.

See `docs/b2b-portal.md` for the complete set of decisions.

## Authentication (Task 3)

Registration, login, logout, and session handling, via Auth.js (next-auth
v5) with a Credentials provider and JWT sessions — deliberately no
database adapter (see `prisma/README.md` for why). The pattern follows the
rest of the codebase:

- `src/app/api/auth/[...nextauth]/route.ts` — thin, just re-exports
  Auth.js's generated handlers (signin, signout, session, callback, csrf,
  providers).
- `src/app/api/auth/register/route.ts` — thin: parses/validates the
  request body, calls `authService.registerUser`, maps errors to HTTP
  status codes. No business logic lives here.
- `src/lib/auth.ts` — Auth.js configuration. The Credentials provider's
  `authorize()` callback validates input and delegates to
  `authService.verifyCredentials` — it does not talk to the database
  directly. The `jwt` callback also enforces session revocation on every
  call (see RBAC/session section below and
  `docs/authentication-hardening.md`).
- `src/modules/identity/services/authService.ts` — the actual business
  logic: duplicate-email rejection (returns `409`, by product decision —
  see `docs/authentication-hardening.md` §5), password hashing/verification,
  suspended-account handling, rate limiting, timing-attack mitigation on
  failed logins. Takes its `UserRepository` and `RateLimiter` as
  constructor parameters (defaulting to the Prisma/Postgres-backed
  implementations), which is what makes it unit-testable without a
  database.
- `src/modules/identity/repositories/userRepository.ts` — the only place
  that talks to Prisma for user data.
- `src/modules/identity/services/passwordService.ts` — argon2id hashing,
  isolated so the algorithm choice is a one-file decision.

New user accounts are created with `status: "active"` rather than the
schema's `pending_verification` default, since no email/phone verification
flow exists yet to ever move a `pending_verification` account onward.
Revisit this when verification is built.

## RBAC policy layer & session revocation (Task 4, and the Task 3 hardening follow-up)

`can(userId, permission)` — implemented as `policyService.can` in
`src/modules/identity/policies.ts` — is the single question this layer
answers: does this user, through any role they hold, have this
permission. It does not know about specific resources (see below).

- `src/modules/identity/permissions.ts` — the canonical list of
  permission keys (`PermissionKey` type), imported by both
  `prisma/seed.ts` and `policies.ts` so the seeded data and the
  type-checked policy layer can't drift apart.
- `src/modules/identity/repositories/permissionRepository.ts` — one
  query aggregating every permission reachable from a user via
  `UserRole -> Role -> RolePermission -> Permission`. Same
  interface/Prisma-implementation split as `userRepository.ts`.
- `src/modules/identity/policies.ts` — `can()` itself. Deliberately
  re-queries the database on every call rather than caching permissions
  in the JWT, for the same reason session revocation does (see below):
  role/permission assignments can change independently of a session, and
  caching them in the token would reintroduce a stale-authorization bug.
- `src/lib/withPermission.ts` — `requirePermission(permission, handler)`,
  a route-handler wrapper: 401 if there's no session, 403 if the session
  exists but lacks the permission, otherwise calls `handler(request,
  { userId })`. Route handlers using this never write their own
  authorization logic.
- `src/app/api/admin/ping/route.ts` — a minimal, deliberately
  feature-less endpoint gated behind the existing `user:manage`
  permission, proving the guard works end-to-end (this was Task 4's
  original acceptance criterion: 403 for a user lacking the permission,
  success for one with it). Not a real admin feature — delete or replace
  it once an actual admin endpoint exists to demonstrate this instead.

**Session revocation is enforced automatically for every `auth()` call,
not just where a special wrapper is used.** This was revised after the
first Task 3 hardening pass (which used a `getValidatedSession()`
wrapper some callers could forget to use) once source-level investigation
of `@auth/core` and `next-auth` confirmed that returning `null` from the
`jwt` callback reliably clears the session for every way `auth()` gets
called — Server Components, Route Handlers, Middleware, and API routes
all share one code path. The check itself
(`sessionSecurityService.isSessionValid`) lives in
`src/modules/identity/services/sessionSecurityService.ts`; the
enforcement point is the `jwt` callback in `lib/auth.ts`. Full writeup,
including the trade-offs of doing this on every session read, in
`docs/authentication-hardening.md`.

**What composes with `can()` later, once real resources exist:**
ownership checks (e.g. "is this agent editing their own listing") belong
at the call site — `can(user, 'listing:update') && listing.ownerId ===
user.id` — not folded into `can()` itself, which has no concept of
resource ownership and shouldn't need one.


## Testing stack

- **Vitest** for unit and integration tests (`tests/unit/`,
  `tests/integration/`), with `@testing-library/react` and `jsdom` for
  component-level tests.
- **Playwright** for end-to-end tests (`tests/e2e/`), driving a real
  browser against a built/served instance of the app.

Both are configured but, at this stage, only proven with minimal smoke
tests — there's no business logic yet for them to meaningfully cover.
