# Ethiopian Property Intelligence Platform (EPIP)

Phase 1, Milestone 1 — Task 1.1: foundation hardening.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the modular-monolith approach
and module responsibilities.

## Stack
Next.js (App Router) · TypeScript (strict) · Tailwind CSS · ESLint 9 ·
Vitest + Testing Library · Playwright

## Scripts
- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm run test` — unit/integration tests (Vitest, single run)
- `npm run test:watch` — unit/integration tests (Vitest, watch mode)
- `npm run test:e2e` — end-to-end tests (Playwright; requires
  `npx playwright install` first)
- `npm run db:generate` — generate the Prisma Client
- `npm run db:migrate` — create/apply a migration in development
- `npm run db:migrate:deploy` — apply existing migrations (CI/production)
- `npm run db:seed` — seed launch roles and permissions
- `npm run db:studio` — Prisma Studio

See [prisma/README.md](./prisma/README.md) for database setup and the
design decisions behind the Task 2 schema.

## Structure
```
src/
  app/          Next.js App Router (pages, layouts; API routes come later)
  modules/      domain modules (services/ + repositories/ per module)
  lib/          cross-cutting utilities (db client, auth config, etc.)
  components/   shared UI components
  types/        shared TypeScript types/DTOs
tests/
  unit/         Vitest component/unit tests
  integration/  Vitest integration tests (empty until repositories exist)
  e2e/          Playwright end-to-end tests
```

## Status
Database schema (Identity, RBAC, Location — Task 2), authentication
(registration, login, logout, session handling — Task 3, hardened in
Task 3.1), RBAC policy enforcement (Task 4: `can()`, the
`requirePermission` route guard, and one proof-of-concept protected
endpoint), the full Property domain layer (Task 5: PostGIS-backed schema,
repository, service with ownership authorization, and RBAC-protected
CRUD/search routes), the full Listing domain layer (Task 6: commercial
offers against a Property, price/status lifecycle, combined price+spatial
search, and price-per-sqm calculation), an automated statistical
valuation engine (Task 7: comparable-sales estimates, an "is this
overpriced?" analyzer, public rate-limited endpoints, and a gated
report-retrieval endpoint), aggregated search + B2B scaffolding
(Task 8: unified property/listing discovery search, a public
rate-limited overpriced-price widget with three input modes, and gated
B2B neighborhood-stats/valuation-summary endpoints), and full API
standardization (Task 9: every Property/Listing/Valuation route plus the
shared RBAC guard now use one consistent response envelope, a universal
error boundary sanitizes unexpected/Prisma errors, and a complete
OpenAPI 3.0 spec is served with interactive docs at `GET /api/docs`),
AI-enriched narrative valuation reports (Task 10: a pluggable LLM
provider adapter — defaulting to a real, deterministic mock requiring no
API key — enriches statistical valuations with plain-language narrative,
with a hard fallback to the plain statistical result on any AI failure),
and a public frontend (Task 11: a property search/discovery portal at
`/properties` with filters, grid/map views, an interactive Leaflet map
with debounced bounds-based re-search, and an embeddable overpriced-price
evaluator widget, backed by a type-safe API client with React Query
caching), and a B2B institutional portal (Task 12: `/b2b/*` pages for
neighborhood market analytics with a residential/commercial/land
breakdown, a full valuation report viewer with a confidence gauge and
comparable-listings table, and a collateral valuation request form
supporting both an existing property ID and manual property entry, all
gated by the existing RBAC permissions and rendering a clean unauthorized
state on 401/403) exist. Full B2B/institutional onboarding (a dedicated
role, API-key access) begins in Task 13 onward. See
[docs/property-domain.md](./docs/property-domain.md),
[docs/listing-domain.md](./docs/listing-domain.md),
[docs/valuation-domain.md](./docs/valuation-domain.md),
[docs/search-and-b2b-domain.md](./docs/search-and-b2b-domain.md),
[docs/api-standardization.md](./docs/api-standardization.md),
[docs/ai-valuation-domain.md](./docs/ai-valuation-domain.md), and
[docs/frontend-portal.md](./docs/frontend-portal.md), and
[docs/b2b-portal.md](./docs/b2b-portal.md) for flagged
decisions.

**Known environment limitation (not a code defect):** in sandboxes where
`binaries.prisma.sh` is network-blocked, `prisma generate` cannot produce
a real Prisma Client, which means `npm run build` fails when Next.js
collects page data for the auth routes (they transitively import
`@prisma/client`). `npm run lint`, `npm run typecheck`, and `npm run test`
are all unaffected and pass in that same environment — unit tests isolate
the database layer via dependency injection / mocking. See
`prisma/README.md` for the full explanation. This is expected to resolve
itself in any environment with normal network access.
