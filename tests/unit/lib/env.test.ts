import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

const STRONG_SECRET = "a".repeat(44); // same length as `openssl rand -base64 32` output
const BASE_ENV = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  AUTH_SECRET: STRONG_SECRET,
} as const;

describe("loadEnv — AUTH_SECRET validation", () => {
  it("accepts a sufficiently long, non-placeholder secret in production", () => {
    expect(() => loadEnv({ ...BASE_ENV, NODE_ENV: "production" })).not.toThrow();
  });

  it("throws in production when AUTH_SECRET is missing", () => {
    const { AUTH_SECRET: _unused, ...rest } = BASE_ENV;
    expect(() => loadEnv({ ...rest, NODE_ENV: "production" })).toThrow();
  });

  it("throws in production when AUTH_SECRET is shorter than the minimum length", () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, NODE_ENV: "production", AUTH_SECRET: "short-secret" })
    ).toThrow(/too short/i);
  });

  it("throws in production for a known placeholder value", () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        AUTH_SECRET: "replace-with-a-real-32-byte-random-secret",
      })
    ).toThrow(/placeholder/i);
  });

  it("throws in production for a known placeholder value regardless of case/whitespace", () => {
    // Padded and re-cased, but still >= 32 chars, so this specifically
    // exercises the placeholder check rather than the length check (a
    // *short* placeholder like "changeme" correctly fails the length
    // check first — both are legitimate rejections, but this test wants
    // to confirm placeholder-matching itself is case/whitespace-insensitive).
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        AUTH_SECRET: "  REPLACE-WITH-A-REAL-32-BYTE-RANDOM-SECRET  ",
      })
    ).toThrow(/placeholder/i);
  });

  it("does NOT throw in development for a short or placeholder secret", () => {
    // Development needs to stay frictionless — the hard rejection is a
    // production-only safeguard, not a blanket rule.
    expect(() =>
      loadEnv({ ...BASE_ENV, NODE_ENV: "development", AUTH_SECRET: "changeme" })
    ).not.toThrow();
  });

  it("never includes the secret's actual value in a thrown error message", () => {
    const weakSecret = "super-secret-value-that-must-not-leak";
    try {
      loadEnv({ ...BASE_ENV, NODE_ENV: "production", AUTH_SECRET: weakSecret });
      expect.unreachable("expected loadEnv to throw for a weak production secret");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(weakSecret);
    }
  });

  it("still requires AUTH_SECRET to be present even outside production", () => {
    const { AUTH_SECRET: _unused, ...rest } = BASE_ENV;
    // Missing entirely (as opposed to weak) fails schema validation
    // regardless of environment — Auth.js cannot function at all without it.
    expect(() => loadEnv({ ...rest, NODE_ENV: "development" })).toThrow();
  });
});

describe("loadEnv — session lifetime configuration", () => {
  it("defaults session maxAge/updateAge to documented values when unset", () => {
    const env = loadEnv(BASE_ENV);
    expect(env.session.maxAgeSeconds).toBe(60 * 60 * 12); // 12 hours
    expect(env.session.updateAgeSeconds).toBe(60 * 60); // 1 hour
  });

  it("honors AUTH_SESSION_MAX_AGE_SECONDS and AUTH_SESSION_UPDATE_AGE_SECONDS when set", () => {
    const env = loadEnv({
      ...BASE_ENV,
      AUTH_SESSION_MAX_AGE_SECONDS: "1800",
      AUTH_SESSION_UPDATE_AGE_SECONDS: "300",
    });
    expect(env.session.maxAgeSeconds).toBe(1800);
    expect(env.session.updateAgeSeconds).toBe(300);
  });
});

describe("loadEnv — rate limit configuration", () => {
  it("defaults every rate-limit threshold to a documented value when unset", () => {
    const env = loadEnv(BASE_ENV);
    expect(env.rateLimit.loginPerEmail).toEqual({ max: 5, windowSeconds: 900 });
    expect(env.rateLimit.loginPerIp).toEqual({ max: 20, windowSeconds: 900 });
    expect(env.rateLimit.registerPerEmail).toEqual({ max: 5, windowSeconds: 3600 });
    expect(env.rateLimit.registerPerIp).toEqual({ max: 10, windowSeconds: 3600 });
  });

  it("honors every rate-limit env var override", () => {
    const env = loadEnv({
      ...BASE_ENV,
      RATE_LIMIT_LOGIN_PER_EMAIL_MAX: "3",
      RATE_LIMIT_LOGIN_PER_EMAIL_WINDOW_SECONDS: "60",
      RATE_LIMIT_LOGIN_PER_IP_MAX: "50",
      RATE_LIMIT_LOGIN_PER_IP_WINDOW_SECONDS: "120",
      RATE_LIMIT_REGISTER_PER_EMAIL_MAX: "2",
      RATE_LIMIT_REGISTER_PER_EMAIL_WINDOW_SECONDS: "600",
      RATE_LIMIT_REGISTER_PER_IP_MAX: "4",
      RATE_LIMIT_REGISTER_PER_IP_WINDOW_SECONDS: "1200",
    });
    expect(env.rateLimit.loginPerEmail).toEqual({ max: 3, windowSeconds: 60 });
    expect(env.rateLimit.loginPerIp).toEqual({ max: 50, windowSeconds: 120 });
    expect(env.rateLimit.registerPerEmail).toEqual({ max: 2, windowSeconds: 600 });
    expect(env.rateLimit.registerPerIp).toEqual({ max: 4, windowSeconds: 1200 });
  });
});
