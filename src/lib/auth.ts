import NextAuth, { type Session, type User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { loginSchema } from "@/lib/validation/identity";
import { env } from "@/lib/env";
import { getClientIp } from "@/lib/getClientIp";
import {
  authService,
  InvalidCredentialsError,
  AccountSuspendedError,
  RateLimitExceededError,
} from "@/modules/identity/services/authService";
import { sessionSecurityService } from "@/modules/identity/services/sessionSecurityService";

/**
 * Extracted as a standalone, exported function (rather than left inline in
 * the `NextAuth({...})` call below) specifically so it can be unit- and
 * integration-tested directly — see
 * tests/integration/sessionRevocation.test.ts — without needing to
 * simulate Auth.js's HTTP/cookie transport layer. Behavior is unchanged
 * from before this extraction; this is a testability refactor, not a
 * redesign.
 */
export async function jwtCallback(
  { token, user }: { token: JWT; user?: User },
  sessionService: Pick<typeof sessionSecurityService, "isSessionValid"> = sessionSecurityService
): Promise<JWT | null> {
  if (user?.id) {
    // Fresh sign-in: authService.verifyCredentials just confirmed
    // this user is active and the password is correct. No need to
    // re-check the database a second time in the same request.
    token.sub = user.id;
    token.securityVersion = user.securityVersion ?? 1;
    return token;
  }

  if (typeof token.sub === "string" && typeof token.securityVersion === "number") {
    const result = await sessionService.isSessionValid(token.sub, token.securityVersion);
    if (!result.valid) {
      return null;
    }
  }

  return token;
}

export async function sessionCallback(
  { session, token }: { session: Session; token: JWT }
): Promise<Session> {
  if (session.user && token.sub) {
    session.user.id = token.sub;
  }
  return session;
}

/**
 * No database adapter is configured on purpose. An adapter (e.g.
 * @auth/prisma-adapter) exists to let NextAuth itself own Account/Session/
 * VerificationToken tables — useful for OAuth account linking or
 * database-backed sessions, neither of which this project uses. With only
 * a Credentials provider and JWT sessions, NextAuth persists nothing;
 * `users` (this project's own table, via the identity module) is the only
 * source of truth for accounts. Adding an adapter now would mean adding
 * schema this project doesn't otherwise need, and NextAuth does not support
 * database session storage for Credentials-based sign-in regardless.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    // Explicit rather than relying on the library default (30 days,
    // undocumented in our own config): see lib/env.ts for the chosen
    // value and reasoning. Configurable via AUTH_SESSION_MAX_AGE_SECONDS.
    maxAge: env.session.maxAgeSeconds,
    updateAge: env.session.updateAgeSeconds,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        const parsed = loginSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        try {
          const user = await authService.verifyCredentials(
            parsed.data.email,
            parsed.data.password,
            { ip: getClientIp(request) }
          );
          return {
            id: user.id,
            email: user.email,
            name: user.fullName,
            securityVersion: user.securityVersion,
          };
        } catch (error) {
          if (
            error instanceof InvalidCredentialsError ||
            error instanceof AccountSuspendedError ||
            error instanceof RateLimitExceededError
          ) {
            // Returning null (rather than throwing, or distinguishing the
            // three cases) is deliberate on two fronts: it's what tells
            // Auth.js "authentication failed," and it avoids leaking
            // *why* it failed — wrong password, suspended account, or
            // rate-limited — back through the client-facing error path.
            // Folding "rate limited" into the same generic failure as
            // "wrong password" specifically avoids turning the rate
            // limiter itself into a new probing signal (an attacker
            // deliberately tripping it to distinguish real accounts from
            // fake ones). The cost is that a legitimate rate-limited user
            // sees the same generic error as a wrong password, with no
            // "try again in N seconds" — accepted as part of this
            // trade-off; see docs/authentication-hardening.md.
            return null;
          }
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    /**
     * Runs on every session read, not just at sign-in — @auth/core decodes
     * the JWT and calls this callback each time `auth()` is invoked
     * anywhere (Server Components, Route Handlers, Middleware, API
     * routes: verified directly from both @auth/core's and next-auth's
     * source — see docs/authentication-hardening.md for exactly what was
     * traced and why this is now trusted to run universally, not just for
     * the literal `/api/auth/session` endpoint).
     *
     * Returning `null` here is not a convention of ours — it's
     * `@auth/core`'s own documented return type for this callback
     * (`Awaitable<JWT | null>`), and its session-read logic treats a null
     * token as "no session": it clears the session cookie and every
     * `auth()` caller receives `null`. This is what makes revocation
     * enforcement automatic and non-optional, rather than something every
     * caller has to remember to check for separately.
     */
    jwt: jwtCallback,
    session: sessionCallback,
  },
  pages: {
    signIn: "/login",
  },
});

