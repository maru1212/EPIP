import { z } from "zod";

/**
 * Single source of truth for environment configuration. Parsed once at
 * import time so misconfiguration fails fast and loudly at startup rather
 * than surfacing as a confusing runtime error deep in a request handler.
 *
 * Security rule for this whole file: never include the *value* of
 * AUTH_SECRET (or any other secret) in a thrown error or log message —
 * only ever reference it by name. A validation failure should tell an
 * operator what's wrong without becoming a new way to leak the secret into
 * logs/error-tracking services.
 */

const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Known placeholder/example values that must never reach production. This
 * list is deliberately small and specific (the literal placeholder this
 * project ships in .env.example, plus a few extremely common ones seen in
 * the wild) rather than an attempt at exhaustively guessing "weak" secrets
 * — length plus this short blocklist covers the realistic failure mode
 * (someone copies .env.example and forgets to replace the value).
 */
const KNOWN_PLACEHOLDER_AUTH_SECRETS = new Set([
  "replace-with-a-real-32-byte-random-secret",
  "changeme",
  "change-me",
  "secret",
  "your-secret-here",
  "next-auth-secret",
  "please-change-me",
]);

function isProductionEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

const positiveIntFromEnv = z.coerce.number().int().positive();

const rawEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required."),

  AUTH_SESSION_MAX_AGE_SECONDS: positiveIntFromEnv.optional(),
  AUTH_SESSION_UPDATE_AGE_SECONDS: positiveIntFromEnv.optional(),

  RATE_LIMIT_LOGIN_PER_EMAIL_MAX: positiveIntFromEnv.optional(),
  RATE_LIMIT_LOGIN_PER_EMAIL_WINDOW_SECONDS: positiveIntFromEnv.optional(),
  RATE_LIMIT_LOGIN_PER_IP_MAX: positiveIntFromEnv.optional(),
  RATE_LIMIT_LOGIN_PER_IP_WINDOW_SECONDS: positiveIntFromEnv.optional(),

  RATE_LIMIT_REGISTER_PER_EMAIL_MAX: positiveIntFromEnv.optional(),
  RATE_LIMIT_REGISTER_PER_EMAIL_WINDOW_SECONDS: positiveIntFromEnv.optional(),
  RATE_LIMIT_REGISTER_PER_IP_MAX: positiveIntFromEnv.optional(),
  RATE_LIMIT_REGISTER_PER_IP_WINDOW_SECONDS: positiveIntFromEnv.optional(),

  // Public, unauthenticated-friendly endpoints (POST /api/valuations/estimate,
  // /api/valuations/analyze-listing) — no permission gate (Task 7 spec's
  // "public freemium access" framing), rate-limited per-IP instead. No
  // per-email limit: these support anonymous requests with no email to key
  // on. See docs/valuation-domain.md.
  RATE_LIMIT_VALUATION_PER_IP_MAX: positiveIntFromEnv.optional(),
  RATE_LIMIT_VALUATION_PER_IP_WINDOW_SECONDS: positiveIntFromEnv.optional(),

  // AI-enriched narrative valuation (Task 10). Defaults to the mock
  // provider whenever no key is configured — this project must work out
  // of the box with no AI provider set up, per the Task 10 spec's
  // explicit requirement. See src/modules/valuation/services/
  // aiProviders/createAIProvider.ts.
  AI_VALUATION_PROVIDER: z.enum(["mock", "anthropic"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_VALUATION_TIMEOUT_MS: positiveIntFromEnv.optional(),
});

/**
 * Validates `process.env` and returns the fully-typed, defaulted config.
 * Exported as a function (rather than only a top-level side effect) so
 * tests can call it directly against a synthetic env object without
 * mutating global process.env or relying on module-cache tricks.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = rawEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problemFields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
    throw new Error(
      `Invalid environment configuration. Problem field(s): ${problemFields.join(", ")}.`
    );
  }

  const raw = parsed.data;
  const nodeEnv = raw.NODE_ENV ?? "development";
  const production = isProductionEnv(nodeEnv);

  if (production) {
    if (raw.AUTH_SECRET.length < MIN_AUTH_SECRET_LENGTH) {
      throw new Error(
        `AUTH_SECRET is too short for production (minimum ${MIN_AUTH_SECRET_LENGTH} characters). ` +
          "Generate one with: openssl rand -base64 32"
      );
    }
    if (KNOWN_PLACEHOLDER_AUTH_SECRETS.has(raw.AUTH_SECRET.trim().toLowerCase())) {
      throw new Error(
        "AUTH_SECRET is set to a known placeholder value and must be replaced before running in production. " +
          "Generate one with: openssl rand -base64 32"
      );
    }
  }

  return {
    nodeEnv,
    isProduction: production,
    databaseUrl: raw.DATABASE_URL,
    authSecret: raw.AUTH_SECRET,
    session: {
      // 12 hours: short enough to bound the exposure window of a leaked
      // token meaningfully, long enough that a user actively working
      // (browsing, managing listings) for a day isn't forced to
      // re-authenticate mid-task. Paired with the per-user security-version
      // check (see modules/identity/services/sessionSecurityService.ts) for
      // revocation *before* natural expiry when that's needed — this value
      // is the fallback bound for everything else.
      maxAgeSeconds: raw.AUTH_SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12,
      // Rolling refresh: a session actively used within the last hour has
      // its expiry pushed forward, so genuinely active users don't hit the
      // maxAge wall mid-session; idle sessions still expire on schedule.
      updateAgeSeconds: raw.AUTH_SESSION_UPDATE_AGE_SECONDS ?? 60 * 60,
    },
    rateLimit: {
      loginPerEmail: {
        max: raw.RATE_LIMIT_LOGIN_PER_EMAIL_MAX ?? 5,
        windowSeconds: raw.RATE_LIMIT_LOGIN_PER_EMAIL_WINDOW_SECONDS ?? 15 * 60,
      },
      loginPerIp: {
        max: raw.RATE_LIMIT_LOGIN_PER_IP_MAX ?? 20,
        windowSeconds: raw.RATE_LIMIT_LOGIN_PER_IP_WINDOW_SECONDS ?? 15 * 60,
      },
      registerPerEmail: {
        max: raw.RATE_LIMIT_REGISTER_PER_EMAIL_MAX ?? 5,
        windowSeconds: raw.RATE_LIMIT_REGISTER_PER_EMAIL_WINDOW_SECONDS ?? 60 * 60,
      },
      registerPerIp: {
        max: raw.RATE_LIMIT_REGISTER_PER_IP_MAX ?? 10,
        windowSeconds: raw.RATE_LIMIT_REGISTER_PER_IP_WINDOW_SECONDS ?? 60 * 60,
      },
      valuationPerIp: {
        max: raw.RATE_LIMIT_VALUATION_PER_IP_MAX ?? 20,
        windowSeconds: raw.RATE_LIMIT_VALUATION_PER_IP_WINDOW_SECONDS ?? 60 * 60,
      },
    },
    ai: {
      provider: raw.AI_VALUATION_PROVIDER ?? "mock",
      anthropicApiKey: raw.ANTHROPIC_API_KEY,
      timeoutMs: raw.AI_VALUATION_TIMEOUT_MS ?? 10_000,
    },
  };
}

export type Env = ReturnType<typeof loadEnv>;

export const env: Env = loadEnv();
