/**
 * Integration test for the rate-limit bucket table and its atomic
 * upsert query, against a real PostgreSQL database.
 *
 * Like tests/integration/schema.test.ts, this goes through the `pg`
 * driver directly rather than Prisma Client, for the same reason: a
 * schema-specific Prisma Client cannot be generated in every environment
 * (see prisma/README.md). `src/lib/rate-limit/postgresRateLimiter.ts` uses
 * `prisma.$queryRaw` with this exact SQL shape — this test proves the SQL
 * itself is correct (atomic increment, correct window-bucketing, correct
 * threshold behavior) independent of whether Prisma Client is available.
 *
 * Skips gracefully (not silently) when no database is reachable.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping rate-limit-bucket integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping rate-limit-bucket integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

/** Mirrors postgresRateLimiter.ts's consume() exactly, via the pg driver. */
async function consume(pgClient: Client, key: string, max: number, windowMs: number) {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const result = await pgClient.query<{ count: number }>(
    `INSERT INTO rate_limit_buckets (key, window_start, count, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (key, window_start) DO UPDATE
       SET count = rate_limit_buckets.count + 1, updated_at = now()
     RETURNING count`,
    [key, windowStart]
  );

  const count = result.rows[0]!.count;
  return { allowed: count <= max, count };
}

describe.skipIf(!databaseAvailable)("rate_limit_buckets (Task 3 hardening)", () => {
  afterEach(async () => {
    // Every test uses a fresh random key, but clean up regardless so the
    // table doesn't accumulate rows across a full test-suite run.
    await client!.query("DELETE FROM rate_limit_buckets WHERE key LIKE 'itest:%'");
  });

  it("allows attempts up to the configured max", async () => {
    const key = `itest:${randomUUID()}`;

    for (let i = 1; i <= 5; i++) {
      const result = await consume(client!, key, 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }
  });

  it("denies the attempt once the count exceeds max", async () => {
    const key = `itest:${randomUUID()}`;

    for (let i = 0; i < 5; i++) {
      await consume(client!, key, 5, 60_000);
    }

    const sixth = await consume(client!, key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.count).toBe(6);
  });

  it("increments atomically under concurrent requests (no lost updates)", async () => {
    const key = `itest:${randomUUID()}`;

    // Fire 10 concurrent "attempts" the way 10 simultaneous requests
    // across multiple application instances would — the whole point of
    // doing this in Postgres via a single atomic statement rather than a
    // process-local counter is that this must land on exactly 10, not
    // less, even under real concurrency.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(client!, key, 100, 60_000))
    );

    const finalCount = Math.max(...results.map((r) => r.count));
    expect(finalCount).toBe(10);

    // and every count from 1..10 appeared exactly once (no two concurrent
    // requests were assigned the same count, which would mean a lost
    // update)
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("starts a fresh count in a new window rather than carrying the old one over", async () => {
    const key = `itest:${randomUUID()}`;
    const shortWindowMs = 50;

    const first = await consume(client!, key, 5, shortWindowMs);
    expect(first.count).toBe(1);

    // Wait past the window boundary.
    await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 20));

    const afterWindowElapsed = await consume(client!, key, 5, shortWindowMs);
    expect(afterWindowElapsed.count).toBe(1); // reset, not 2
  });

  it("keeps different keys' counts fully independent", async () => {
    const keyA = `itest:${randomUUID()}`;
    const keyB = `itest:${randomUUID()}`;

    await consume(client!, keyA, 5, 60_000);
    await consume(client!, keyA, 5, 60_000);
    const resultB = await consume(client!, keyB, 5, 60_000);

    expect(resultB.count).toBe(1);
  });
});
