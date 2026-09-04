import { prisma } from "@/lib/db";
import type { RateLimiter, RateLimitResult } from "./rateLimiter";

/**
 * Fixed-window rate limiting backed by Postgres, via the `rate_limit_buckets`
 * table (see prisma/schema.prisma). Every application instance shares the
 * same database, so this is correct under concurrent access from multiple
 * instances — the ON CONFLICT upsert is a single atomic statement, not a
 * read-then-write race.
 *
 * Why Postgres and not Redis: this project has no Redis (or any other
 * shared cache) in its stack yet, and introducing one solely for rate
 * limiting would be new infrastructure to run, secure, and pay for, for a
 * problem the existing database already solves correctly at this project's
 * scale. If request volume ever makes per-attempt Postgres writes a
 * bottleneck, that's the point to introduce Redis — not before.
 *
 * Trade-off being accepted: every rate-limited request costs one write to
 * Postgres. At auth-endpoint volumes (registration, login attempts) this is
 * negligible; it would not be an appropriate pattern for rate-limiting
 * high-frequency endpoints (e.g. per-request API rate limiting across the
 * whole app).
 */
export const postgresRateLimiter: RateLimiter = {
  async consume(key, max, windowMs): Promise<RateLimitResult> {
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const resetAt = new Date(windowStart.getTime() + windowMs);

    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, window_start, count, updated_at)
      VALUES (${key}, ${windowStart}, 1, now())
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = rate_limit_buckets.count + 1, updated_at = now()
      RETURNING count
    `;

    const count = rows[0]?.count ?? max + 1;
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      limit: max,
      resetAt,
    };
  },
};

/**
 * Deletes buckets from windows that have fully elapsed. Not wired up to a
 * scheduler in this task (no job runner exists yet in this project) — this
 * exists so the table doesn't need an unbounded-growth design change later;
 * call it from whatever periodic job mechanism gets introduced first.
 */
export async function pruneExpiredRateLimitBuckets(olderThan: Date): Promise<number> {
  const result = await prisma.$executeRaw`
    DELETE FROM rate_limit_buckets WHERE window_start < ${olderThan}
  `;
  return result;
}
