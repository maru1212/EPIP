export interface RateLimitResult {
  allowed: boolean;
  /** Attempts remaining in the current window, floored at 0. */
  remaining: number;
  limit: number;
  /** When the current window ends and the count resets. */
  resetAt: Date;
}

/**
 * Storage-agnostic rate limiting contract. `consume` atomically records one
 * attempt against `key` and reports whether the caller is still within
 * `max` attempts for a fixed window of `windowMs` milliseconds.
 *
 * Implementations MUST be safe under concurrent calls from multiple
 * application instances hitting the same key at once — that's the whole
 * point of going through this interface instead of a local counter.
 */
export interface RateLimiter {
  consume(key: string, max: number, windowMs: number): Promise<RateLimitResult>;
}
