import type { RegisterInput } from "@/lib/validation/identity";
import { env } from "@/lib/env";
import { checkAndConsume } from "@/lib/rate-limit/checkAndConsume";
import { postgresRateLimiter } from "@/lib/rate-limit/postgresRateLimiter";
import type { RateLimiter } from "@/lib/rate-limit/rateLimiter";
import { hashPassword, verifyPassword, DUMMY_HASH_FOR_TIMING_MITIGATION } from "./passwordService";
import { prismaUserRepository, type UserRepository } from "../repositories/userRepository";
import type { DomainUser } from "../types";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountSuspendedError extends Error {
  constructor() {
    super("This account has been suspended.");
    this.name = "AccountSuspendedError";
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

export class RateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many attempts. Please try again later.");
    this.name = "RateLimitExceededError";
  }
}

export interface RequestContext {
  ip: string;
}

/**
 * Factory rather than a bare singleton export, so tests can inject an
 * in-memory UserRepository and a fake RateLimiter and exercise all of this
 * module's business logic (rate limiting, duplicate-email handling,
 * password hashing, credential verification, suspended-account handling)
 * with no database involved. `authService` below is the production
 * instance route handlers use.
 */
export function createAuthService(
  repository: UserRepository = prismaUserRepository,
  rateLimiter: RateLimiter = postgresRateLimiter
) {
  return {
    /**
     * Explicitly rejects an already-registered email with
     * DuplicateEmailError, by product decision: for this MVP, giving a
     * returning user immediate, unambiguous feedback ("you already have
     * an account, log in instead") was judged more valuable than closing
     * the registration-side account-enumeration gap this creates. See
     * docs/authentication-hardening.md §5 for the full trade-off —
     * including that this was a considered reversal of an earlier,
     * enumeration-safe design, not an oversight. Login-side enumeration
     * protection (verifyCredentials, below) is unaffected and unchanged.
     */
    async registerUser(input: RegisterInput, context: RequestContext): Promise<DomainUser> {
      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `register:ip:${context.ip}`,
          max: env.rateLimit.registerPerIp.max,
          windowSeconds: env.rateLimit.registerPerIp.windowSeconds,
        },
        {
          key: `register:email:${input.email}`,
          max: env.rateLimit.registerPerEmail.max,
          windowSeconds: env.rateLimit.registerPerEmail.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new RateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const existing = await repository.findByEmail(input.email);
      if (existing) {
        throw new DuplicateEmailError();
      }

      const passwordHash = await hashPassword(input.password);

      // New accounts are created "active" rather than the schema's
      // "pending_verification" default: no email/phone verification flow
      // exists yet to ever move a "pending_verification" account onward.
      // See docs/authentication-hardening.md for what changes here once
      // verification is built.
      return repository.create({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone ?? null,
        status: "active",
      });
    },

    async verifyCredentials(
      email: string,
      password: string,
      context: RequestContext
    ): Promise<DomainUser> {
      const normalizedEmail = email.trim().toLowerCase();

      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `login:email:${normalizedEmail}`,
          max: env.rateLimit.loginPerEmail.max,
          windowSeconds: env.rateLimit.loginPerEmail.windowSeconds,
        },
        {
          key: `login:ip:${context.ip}`,
          max: env.rateLimit.loginPerIp.max,
          windowSeconds: env.rateLimit.loginPerIp.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new RateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const user = await repository.findByEmail(normalizedEmail);

      if (!user || !user.passwordHash) {
        // Do a dummy verify so this path takes comparable time to the
        // "user exists but wrong password" path below — otherwise response
        // timing leaks whether an email is registered.
        await verifyPassword(DUMMY_HASH_FOR_TIMING_MITIGATION, password);
        throw new InvalidCredentialsError();
      }

      const passwordMatches = await verifyPassword(user.passwordHash, password);
      if (!passwordMatches) {
        throw new InvalidCredentialsError();
      }

      if (user.status === "suspended") {
        throw new AccountSuspendedError();
      }

      return user;
    },
  };
}

export const authService = createAuthService();
