/**
 * Focused integration test proving session revocation through the REAL
 * mechanism:
 *
 * 1. A user "authenticates" (a row exists with a known password hash —
 *    credential-verification logic itself is covered exhaustively by
 *    authService.test.ts's unit tests; this test's focus is specifically
 *    the revocation mechanism downstream of that).
 * 2. The resulting token is valid, per the REAL, exported `jwtCallback`
 *    from lib/auth.ts (the exact function wired into `NextAuth({
 *    callbacks: { jwt: jwtCallback } })` — not a reimplementation).
 * 3. The user's security_version changes, via the REAL
 *    `createSessionSecurityService` logic from sessionSecurityService.ts.
 * 4. The OLD token is rejected by the same real `jwtCallback`.
 * 5. A fresh token (as a new sign-in would produce) is valid again.
 *
 * What's real: `jwtCallback` (lib/auth.ts, unmodified except for the
 * dependency-injection parameter every other service in this codebase
 * already has) and `createSessionSecurityService`'s actual validation
 * logic (sessionSecurityService.ts, unmodified). What's substituted: the
 * `UserRepository` this test constructs queries the SAME live database
 * directly via the `pg` driver instead of through Prisma Client —
 * identical in spirit to every other integration test in this suite
 * (schema.test.ts, rateLimitBucket.test.ts, rbacPermissions.test.ts,
 * property.test.ts), because a schema-specific Prisma Client cannot be
 * generated in this environment (prisma/README.md). This is NOT an
 * in-memory fake standing in for the database — every read/write in this
 * test hits the real `users` table.
 *
 * What this does NOT exercise: Auth.js's HTTP cookie encode/decode, or
 * `auth()`/the `/api/auth/session` route end-to-end — that requires a
 * running Next.js server, which cannot start in this environment for the
 * same reason `npm run build` fails (the real `prismaUserRepository`
 * `jwtCallback` defaults to would hit the same un-generated-client wall
 * the moment a real request reached it).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { createSessionSecurityService } from "@/modules/identity/services/sessionSecurityService";
import { hashPassword } from "@/modules/identity/services/passwordService";
import { jwtCallback } from "@/lib/auth";
import type { UserRepository } from "@/modules/identity/repositories/userRepository";
import type { UserStatus } from "@/modules/identity/types";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping session revocation integration test."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping session revocation integration test.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

/**
 * Implements exactly the two UserRepository methods sessionSecurityService
 * needs, via raw SQL against the real database — see file header.
 */
function createPgUserRepository(pgClient: Client): Pick<
  UserRepository,
  "getSecurityStatus" | "bumpSecurityVersion"
> {
  return {
    async getSecurityStatus(userId) {
      const result = await pgClient.query<{
        security_version: number;
        status: UserStatus;
      }>(`SELECT security_version, status FROM users WHERE id = $1`, [userId]);
      const row = result.rows[0];
      return row ? { securityVersion: row.security_version, status: row.status } : null;
    },
    async bumpSecurityVersion(userId) {
      const result = await pgClient.query<{ security_version: number }>(
        `UPDATE users SET security_version = security_version + 1 WHERE id = $1
         RETURNING security_version`,
        [userId]
      );
      return result.rows[0]!.security_version;
    },
  };
}

describe.skipIf(!databaseAvailable)("Session revocation via the real jwtCallback", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      await client!.query("DELETE FROM users WHERE id = $1", [createdUserIds.pop()]);
    }
  });

  it("rejects an old token after security_version changes, and a fresh token is valid again", async () => {
    const sessionService = createSessionSecurityService(
      createPgUserRepository(client!) as UserRepository
    );

    const email = `revocation-itest-${randomUUID()}@example.com`;
    const passwordHash = await hashPassword("correct-horse-battery-staple");

    // --- Step 1: user "authenticates" (row exists with a real argon2id hash).
    const userResult = await client!.query<{ id: string; security_version: number }>(
      `INSERT INTO users (email, password_hash, full_name, status, updated_at)
       VALUES ($1, $2, 'Revocation Test User', 'active', now())
       RETURNING id, security_version`,
      [email, passwordHash]
    );
    const userId = userResult.rows[0]!.id;
    const initialSecurityVersion = userResult.rows[0]!.security_version;
    createdUserIds.push(userId);

    // The JWT payload shape lib/auth.ts's authorize() would have produced
    // at sign-in — token.securityVersion embeds whatever was current then.
    const tokenAtSignIn = { sub: userId, securityVersion: initialSecurityVersion };

    // --- Step 2: session is valid (a session read with no `user` param —
    // the exact call shape @auth/core uses for every request after the
    // initial sign-in; see docs/authentication-hardening.md).
    const resultBeforeRevocation = await jwtCallback(
      { token: { ...tokenAtSignIn } },
      sessionService
    );
    expect(resultBeforeRevocation).not.toBeNull();
    expect(resultBeforeRevocation?.sub).toBe(userId);

    // --- Step 3: security_version changes for real, in the real table.
    const newVersion = await sessionService.revokeAllSessions(userId);
    expect(newVersion).toBe(initialSecurityVersion + 1);

    const dbRowAfterRevocation = await client!.query<{ security_version: number }>(
      `SELECT security_version FROM users WHERE id = $1`,
      [userId]
    );
    expect(dbRowAfterRevocation.rows[0]!.security_version).toBe(newVersion);

    // --- Step 4: the OLD token (still embedding the pre-revocation
    // version) is rejected by the real jwtCallback.
    const resultAfterRevocation = await jwtCallback(
      { token: { ...tokenAtSignIn } },
      sessionService
    );
    expect(resultAfterRevocation).toBeNull();

    // --- Step 5: a fresh token (embedding the NEW version, as a fresh
    // sign-in's authorize() would produce) is valid.
    const freshToken = { sub: userId, securityVersion: newVersion };
    const resultForFreshLogin = await jwtCallback(
      { token: { ...freshToken } },
      sessionService
    );
    expect(resultForFreshLogin).not.toBeNull();
    expect(resultForFreshLogin?.sub).toBe(userId);
  });

  it("rejects a token immediately when the account is suspended, independent of security_version", async () => {
    const sessionService = createSessionSecurityService(
      createPgUserRepository(client!) as UserRepository
    );

    const email = `suspend-itest-${randomUUID()}@example.com`;
    const userResult = await client!.query<{ id: string; security_version: number }>(
      `INSERT INTO users (email, full_name, status, updated_at)
       VALUES ($1, 'Suspend Test User', 'active', now())
       RETURNING id, security_version`,
      [email]
    );
    const userId = userResult.rows[0]!.id;
    const securityVersion = userResult.rows[0]!.security_version;
    createdUserIds.push(userId);

    const token = { sub: userId, securityVersion };
    expect(await jwtCallback({ token: { ...token } }, sessionService)).not.toBeNull();

    await client!.query("UPDATE users SET status = 'suspended' WHERE id = $1", [userId]);

    // Same security_version as before — only status changed — and the
    // token is still rejected, proving the status check is independent
    // of the security-version check.
    expect(await jwtCallback({ token: { ...token } }, sessionService)).toBeNull();
  });

  it("jwtCallback embeds token.sub/securityVersion from a fresh sign-in's user object, without hitting the database", async () => {
    // The `user` branch (fresh sign-in) is intentionally DB-free — see
    // the comment in jwtCallback. Pass a session service that would throw
    // if called, proving this branch really does short-circuit.
    const sessionServiceThatMustNotBeCalled = {
      async isSessionValid(): Promise<never> {
        throw new Error("isSessionValid should not be called on a fresh sign-in");
      },
    };

    const result = await jwtCallback(
      {
        token: {},
        user: { id: "user-123", securityVersion: 7, email: "x@example.com" },
      },
      sessionServiceThatMustNotBeCalled
    );

    expect(result?.sub).toBe("user-123");
    expect(result?.securityVersion).toBe(7);
  });
});
