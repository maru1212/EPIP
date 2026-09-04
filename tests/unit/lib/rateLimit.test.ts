import { describe, expect, it } from "vitest";
import { checkAndConsume } from "@/lib/rate-limit/checkAndConsume";
import { createFakeRateLimiter } from "../../helpers/fakeRateLimiter";

describe("checkAndConsume", () => {
  it("allows requests within every configured limit", async () => {
    const limiter = createFakeRateLimiter();

    const result = await checkAndConsume(limiter, [
      { key: "a", max: 5, windowSeconds: 60 },
      { key: "b", max: 5, windowSeconds: 60 },
    ]);

    expect(result.allowed).toBe(true);
  });

  it("denies once any single key's limit is exceeded", async () => {
    const limiter = createFakeRateLimiter();
    limiter.counts.set("a", 100);

    const result = await checkAndConsume(limiter, [
      { key: "a", max: 5, windowSeconds: 60 },
      { key: "b", max: 5, windowSeconds: 60 },
    ]);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("consumes every key even when an earlier key already failed", async () => {
    const limiter = createFakeRateLimiter();
    limiter.counts.set("a", 100);

    await checkAndConsume(limiter, [
      { key: "a", max: 5, windowSeconds: 60 },
      { key: "b", max: 5, windowSeconds: 60 },
    ]);

    // "b" must have been consumed exactly once, not skipped because "a"
    // already failed — this is what prevents the check order from
    // becoming an information leak or a bypass.
    expect(limiter.counts.get("b")).toBe(1);
  });

  it("reports the most restrictive retryAfterSeconds across multiple failing keys", async () => {
    const limiter = createFakeRateLimiter();
    // Both keys are already over their limits, but "b"'s window is longer.
    limiter.counts.set("a", 100);
    limiter.counts.set("b", 100);

    const result = await checkAndConsume(limiter, [
      { key: "a", max: 5, windowSeconds: 60 },
      { key: "b", max: 5, windowSeconds: 3600 },
    ]);

    expect(result.allowed).toBe(false);
    // Should reflect the longer (3600s) window, not the shorter one.
    expect(result.retryAfterSeconds).toBeGreaterThan(60);
  });
});
