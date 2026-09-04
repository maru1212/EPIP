import { prismaUserRepository, type UserRepository } from "../repositories/userRepository";

export type SessionInvalidReason = "not_found" | "suspended" | "revoked";

export type SessionValidationResult =
  | { valid: true }
  | { valid: false; reason: SessionInvalidReason };

/**
 * Factory (not a bare singleton) for the same reason as authService: it
 * lets tests inject a fake UserRepository and exercise this logic with no
 * database involved.
 *
 * SECURITY TRADE-OFF (documented per the hardening review):
 * This project uses stateless JWT sessions with no server-side session
 * table, specifically to avoid taking on database-backed sessions before
 * there's a concrete reason to. The cost of that choice is that a JWT's
 * signature being valid does NOT by itself mean the session is still
 * authorized — the token could have been issued to a user who has since
 * been suspended, or whose sessions were explicitly revoked.
 *
 * `isSessionValid` closes that gap by comparing the security_version
 * embedded in the token (set once, at sign-in) against the CURRENT value
 * in the database. Raising a user's security_version (see
 * `revokeAllSessions` below) makes every previously-issued token fail this
 * check on its next validation, regardless of the token's remaining
 * natural lifetime (see AUTH_SESSION_MAX_AGE_SECONDS in lib/env.ts).
 *
 * This requires a database read to validate a session — the one piece of
 * "statelessness" this project's JWT approach gives up. That's a
 * deliberate, bounded trade-off: one indexed primary-key lookup per
 * validated-session check, not a full session-table join, and nothing
 * changes about how sessions are issued or how the JWT itself is
 * structured.
 *
 * ENFORCEMENT: this check runs automatically, inside `lib/auth.ts`'s
 * `jwt` callback, on every session read — not just at sign-in. `auth()`
 * (the standard Auth.js session accessor) therefore already enforces
 * this for every caller: Server Components, Route Handlers, Middleware,
 * and API routes all funnel through the same `getSession()` path in both
 * `@auth/core` and `next-auth` (confirmed directly from both packages'
 * source — see docs/authentication-hardening.md for what was traced).
 * When this check fails, the `jwt` callback returns `null`, which
 * `@auth/core` treats as "no session": it clears the session cookie and
 * every `auth()` caller receives `null` for that request. There is no
 * separate wrapper function to remember to call — plain `auth()` is
 * trustworthy.
 *
 * This does mean every `auth()` call — including ones that only need "is
 * someone signed in" for display purposes — now pays one indexed
 * database lookup. That cost was accepted deliberately in favor of
 * enforcement being automatic rather than convention-based; see
 * docs/authentication-hardening.md if this ever needs revisiting (e.g.
 * caching the check for a few seconds, if it becomes a measurable load
 * concern).
 */
export function createSessionSecurityService(
  repository: UserRepository = prismaUserRepository
) {
  return {
    async isSessionValid(
      userId: string,
      securityVersionInToken: number
    ): Promise<SessionValidationResult> {
      const current = await repository.getSecurityStatus(userId);

      if (!current) {
        return { valid: false, reason: "not_found" };
      }
      if (current.status === "suspended") {
        return { valid: false, reason: "suspended" };
      }
      if (current.securityVersion !== securityVersionInToken) {
        return { valid: false, reason: "revoked" };
      }
      return { valid: true };
    },

    /**
     * Invalidates every existing session for a user, independent of
     * account status. Note that suspending a user (setting `status` to
     * "suspended") already invalidates their existing sessions on its
     * own — `isSessionValid` above checks status directly, and that check
     * runs automatically on every `auth()` call (see lib/auth.ts). This
     * method exists for forced invalidation that ISN'T a suspension: a
     * future password-change flow should call this so a compromised
     * password can't keep an old session alive after the legitimate
     * owner changes it, and a future "log out of all devices" self-service
     * feature would call this too. Nothing calls it yet in this codebase.
     */
    async revokeAllSessions(userId: string): Promise<number> {
      return repository.bumpSecurityVersion(userId);
    },
  };
}

export const sessionSecurityService = createSessionSecurityService();
