import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * `src/lib/env.ts` validates process.env at import time and throws if
 * DATABASE_URL/AUTH_SECRET are missing — correct and intentional for the
 * real app (fail fast at startup), but it means any unit test that
 * transitively imports a module depending on `env` (e.g. authService,
 * which reads rate-limit thresholds from it) would fail to even import
 * unless something in the test environment provides these first.
 *
 * `??=` deliberately does not override a real value: when a test run
 * explicitly exports DATABASE_URL (e.g. `DATABASE_URL=... npm run test`,
 * used to run the database integration tests against a live instance),
 * that value is left untouched. This only fills in a harmless default for
 * unit-test runs where no real database is involved at all.
 */
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/unit_test_placeholder";
process.env.AUTH_SECRET ??= "unit-test-only-secret-not-used-for-anything-real";

/**
 * Unit tests should never depend on a real database connection or a real
 * generated Prisma Client — that's what integration tests
 * (tests/integration/) are for. Modules under unit test (e.g. authService)
 * are exercised with an explicitly injected fake repository, but they
 * still transitively import the repository module, which imports
 * `@/lib/db`, which constructs a `PrismaClient`. This mock keeps that
 * import inert for unit tests regardless of whether a real client has been
 * generated for this schema.
 */
vi.mock("@prisma/client", () => ({
  PrismaClient: class {},
}));
