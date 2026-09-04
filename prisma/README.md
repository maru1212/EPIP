# Database (Task 2, extended in Task 5)

Identity, RBAC, and Location foundation (Task 2), plus PropertyType and
Property — the canonical physical-asset record, including PostGIS
coordinates (Task 5). No Listing, PriceHistory, or other future-scope
models exist yet.

## Local setup

1. PostgreSQL 14+ with the PostGIS extension available (PostGIS itself is
   created by the migration — you just need the extension package
   installed on the server, e.g. `postgresql-16-postgis-3` on Debian/
   Ubuntu, or the `postgis` Homebrew formula on macOS).
2. Copy `.env.example` to `.env` and adjust `DATABASE_URL` if needed.
3. `npm run db:migrate:deploy` — applies the existing migrations as-is
   (recommended first run, see note below on why we're not starting with
   `db:migrate`).
4. `npm run db:generate` — generates the Prisma Client.
5. `npm run db:seed` — seeds the launch roles, permissions, and property
   types.

## Design decisions

### UUIDs
Primary keys use PostgreSQL's built-in `gen_random_uuid()` (core since
PostgreSQL 13, no extension required) as a database-level default, rather
than generating IDs in application code. This is more robust for a
platform that will eventually have things writing to the database outside
the Next.js app — seed scripts, admin tooling, and, later, ingestion
pipelines — since the ID is always correct regardless of what wrote the
row.

### RBAC stays table-driven
`Role`, `Permission`, `RolePermission`, and `UserRole` are plain tables,
not enums. Adding a role (Valuer, Institutional Client, Super Admin) or a
permission later is a data change (an `INSERT`), not a migration.

### LocationNode.level is an enum, not a lookup table
Unlike roles, the set of administrative levels (`country`, `region`,
`zone`, `city`, `subcity`, `woreda`, `kebele`, `neighborhood`) is a small,
nationally standard, slow-changing vocabulary — closer to `UserStatus`
than to `Role`. It's modeled as a native Postgres enum for query
efficiency and data integrity. The actual *hierarchy per city* is still
fully flexible via `parent_id` self-reference: Addis Ababa's
subcity→woreda→neighborhood chain and a different city's shallower chain
both fit the same table without any schema change.

### PostGIS handled outside Prisma
Prisma has no native `geometry`/`geography` type. `LocationNode.boundary`
is declared `Unsupported("geometry(Polygon, 4326)")` in `schema.prisma` —
Prisma is aware the column exists (for introspection/diffing purposes) but
Prisma Client cannot read or write it directly. All boundary
reads/writes/spatial queries go through `$queryRaw`/`$executeRaw` once
that code is written (not yet, in Task 2). The spatial GIST index was also
added by hand in the migration SQL, not via Prisma's index syntax.

We evaluated Prisma's `postgresqlExtensions` preview feature (which would
let `schema.prisma` declare `extensions = [postgis]` and have Prisma
generate the `CREATE EXTENSION` statement itself), but Prisma has
announced this specific preview feature is being discontinued in favor of
extension-specific support shipped independently. We didn't want to build
on a feature already flagged for removal, so the extension is created with
a plain `CREATE EXTENSION IF NOT EXISTS postgis;` at the top of the
migration instead — which is also what the task instructions asked for.

### Property.coordinates: geography, not geometry (Task 5)
`LocationNode.boundary` (Task 2) is `geometry(Polygon, 4326)`;
`Property.coordinates` (Task 5) is `geography(Point, 4326)`. This is
deliberate, not an inconsistency: `ST_DWithin(a, b, meters)` on a
`geography` column interprets its third argument as real-world meters,
which is what "properties within 2km" needs. The same call against a
`geometry` column on SRID 4326 (plain lat/lon degrees) would silently
interpret that argument as *degrees* instead — badly wrong for a radius
search, and easy to not notice until the numbers are checked carefully.
`geometry` remains the right choice for `boundary` because containment
checks (`ST_Contains`) don't have this unit ambiguity, and `geometry` has
broader function support for polygon operations generally. Both columns
are `Unsupported` in schema.prisma (Prisma has no native geography or
geometry type) and are only ever read/written via `$queryRaw`/
`$executeRaw` — see `src/modules/property/repositories/propertyRepository.ts`.

### Prisma 6, not Prisma 7 (reversible decision, not a permanent lock-in)
Prisma 7 (released recently) requires a mandatory driver adapter for every
database, moves the connection URL out of `schema.prisma` into a new
`prisma.config.ts`, ships as ESM-only, and changes the generator to
require a custom `output` path. That's a lot of new moving parts for a
foundational task where the goal is to avoid unnecessary complexity. We
used the latest Prisma 6 release (6.19.3) instead: classic schema-file
configuration, one dependency fewer (no adapter package required), and
extensive real-world track record.

This is a **reversible technology choice, not an architectural
commitment**: nothing in the domain modules, services, or repositories
depends on Prisma-6-specific APIs beyond `PrismaClient` and standard query
methods, which are stable across the 6→7 transition. Revisit this when
either (a) the platform's needs outgrow Prisma 6, or (b) Prisma 7 stabilizes
and its driver-adapter requirement stops being a net increase in
complexity — not before, and not as a reaction to this sandbox's specific
limitations.

### Referential actions
- `role_permissions` → both FKs `CASCADE`: it's a pure join table with no
  independent meaning once either side is gone.
- `user_roles.user_id` → `CASCADE`: a user's role assignments are
  meaningless once the user is gone. (In practice, per the "prefer
  soft-deactivation over destructive deletes" principle, real users are
  expected to be suspended via `User.status`, not deleted — this is the
  safety net for the case where a row genuinely is deleted.)
- `user_roles.role_id` → `RESTRICT`: you cannot delete a role while users
  still hold it. Reassign users first. This protects against silently
  revoking someone's access as a side effect of unrelated cleanup.
- `location_nodes.parent_id` → `RESTRICT`: you cannot delete a location
  node that still has children. Reassign or remove children first. This
  protects the location hierarchy from silent corruption.

## A note on Prisma CLI commands in restricted-network environments

`prisma migrate dev`, `prisma generate`, `prisma validate`, and
`prisma format` all depend on downloading Prisma's schema-engine binary
from `binaries.prisma.sh` on first use. In network-restricted environments
(CI runners or sandboxes with an egress allowlist that doesn't include
that host), all of these commands fail with a 403 before they do anything
else — this includes `prisma format`, which is otherwise a purely local
operation.

If you hit this: add `binaries.prisma.sh` to your environment's allowed
outbound domains, or point `PRISMA_ENGINES_MIRROR` at an internal mirror
if your organization runs one. There is no way to use the Prisma CLI
without one of these.

The migration in this repository (`prisma/migrations/`) was authored by
hand to exactly match what `prisma migrate dev` would generate from
`prisma/schema.prisma`, plus the manual PostGIS additions described above,
because the schema-engine binary could not be downloaded in the
environment this was built in. It has been applied and verified against a
real local PostgreSQL 16 + PostGIS 3.4 instance (see the root-level task
report for exactly what was checked). It should still be treated as
**unverified by the actual Prisma CLI** until someone runs
`npx prisma migrate deploy` (or `db:migrate:deploy`) against it in an
environment with normal network access, to confirm Prisma's own drift
detection considers the schema and migration in sync. If Prisma's
schema-engine and this hand-written migration ever disagree, the compiled
schema-engine's understanding is not automatically wrong — check the
diff before assuming the migration is correct.
