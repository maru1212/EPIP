import type { RateLimiter, RateLimitResult } from "@/lib/rate-limit/rateLimiter";

/**
 * Test-only fake. This is deliberately NOT exported from src/lib —
 * production code must use postgresRateLimiter (or a future
 * multi-instance-safe alternative), never a process-local counter. This
 * exists purely so authService's rate-limiting logic can be unit tested
 * without a database, the same way the fake UserRepository works.
 */
export function createFakeRateLimiter(): RateLimiter & {
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();

  return {
    counts,
    async consume(key, max, windowMs): Promise<RateLimitResult> {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return {
        allowed: next <= max,
        remaining: Math.max(0, max - next),
        limit: max,
        resetAt: new Date(Date.now() + windowMs),
      };
    },
  };
}
