import type { RateLimiter } from "./rateLimiter";

export interface RateLimitKeyCheck {
  key: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  /** Only set when `allowed` is false. */
  retryAfterSeconds?: number;
}

/**
 * Consumes an attempt against every key in `checks`, unconditionally —
 * every key is always consumed even if an earlier one already failed, and
 * even if the overall result will be "denied". This matters for security,
 * not just correctness: if a per-email key were only consulted after a
 * per-IP key passed, or only consumed on some code paths, the number of
 * attempts allowed before hitting the limit could differ in ways that leak
 * information (e.g. whether an email exists) or that create a bypass. Every
 * caller of this function gets an identical amount of bucket-consumption
 * work done regardless of which checks pass or fail.
 */
export async function checkAndConsume(
  limiter: RateLimiter,
  checks: RateLimitKeyCheck[]
): Promise<RateLimitCheckResult> {
  let result: RateLimitCheckResult = { allowed: true };

  for (const check of checks) {
    const outcome = await limiter.consume(check.key, check.max, check.windowSeconds * 1000);
    if (!outcome.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((outcome.resetAt.getTime() - Date.now()) / 1000)
      );
      // Keep the most restrictive (largest) retry-after seen across all
      // failed checks, so the caller doesn't under-promise how long to wait.
      if (!result.retryAfterSeconds || retryAfterSeconds > result.retryAfterSeconds) {
        result = { allowed: false, retryAfterSeconds };
      }
    }
  }

  return result;
}
