# Authentication Hardening (Task 3.1)

This document records the decisions made in response to the Task 3 security
review, before Task 4 (RBAC) begins. It's the canonical explanation
referenced from code comments in `lib/auth.ts`, `lib/env.ts`,
`modules/identity/services/authService.ts`, and
`modules/identity/services/sessionSecurityService.ts` — read this for the
*why*, those files for the *what*.

No replacement of Auth.js v5 / Credentials / JWT was made or considered
necessary. Everything below builds on top of that architecture.

---

## 1. Rate limiting

**Design:** a storage-agnostic `RateLimiter` interface
(`src/lib/rate-limit/rateLimiter.ts`) with a fixed-window `consume(key, max,
windowMs)` contract, implemented by `postgresRateLimiter`
(`src/lib/rate-limit/postgresRateLimiter.ts`).

**Why Postgres, not an in-memory counter or Redis:**
- An in-process counter is explicitly wrong here per the requirement that
  this work correctly across multiple deployed instances — each instance
  would have its own counter, so a limit of "5 attempts" would actually
  allow `5 × (number of instances)`.
- Redis (or another dedicated cache) is the conventional answer, but this
  project has no such infrastructure today, and introducing one solely for
  rate limiting is new infrastructure to run, secure, and pay for, before
  there's a concrete reason it's needed.
- Every application instance already shares the same Postgres database.
  `rate_limit_buckets` (see `prisma/schema.prisma`) plus a single atomic
  `INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count +
  1` statement gives genuinely correct behavior under concurrent access
  from multiple instances — this was verified directly (see Testing
  section below), including specifically under concurrent requests.
- **Trade-off accepted:** every rate-limited request costs one write to
  Postgres. Fine at auth-endpoint volumes; would not be the right pattern
  for high-frequency, whole-app API rate limiting. If request volume ever
  makes this a bottleneck, that's the point to introduce Redis — not
  before.

**What's protected, and how:**
- Login (`authService.verifyCredentials`) is throttled **both** per email
  (`login:email:<email>`) and per source IP (`login:ip:<ip>`) — per-email
  stops brute-forcing one account from many IPs; per-IP (looser, since one
  IP can be many legitimate users) stops one source hammering many
  accounts.
- Registration (`authService.registerUser`) is throttled both per IP
  (`register:ip:<ip>`) and per email (`register:email:<email>`) —
  per-IP bounds bulk account creation; per-email bounds repeated
  registration probes against one address.
- Both brute-force (many attempts against one target) and volumetric abuse
  (many requests generally) are covered by the per-identifier vs. per-IP
  split above.
- Every configured key is **always consumed**, even if an earlier key in
  the same check already failed (see `checkAndConsume`'s doc comment) —
  this specifically prevents the rate limiter itself from becoming a new
  side-channel (e.g., short-circuiting on the per-email key first would
  mean the per-IP bucket is sometimes consumed and sometimes not,
  depending on whether the email exists).
- All thresholds are environment-configurable
  (`RATE_LIMIT_LOGIN_PER_EMAIL_MAX`, etc. — see `.env.example` for the
  full list and `src/lib/env.ts` for defaults), not hard-coded.

**Client-facing behavior:** both login and registration fold "rate
limited" into the same generic failure the client already sees for other
reasons (wrong password / suspended account for login; nothing distinctive
at all for registration, which never reveals success vs. duplicate
either — see §5). This is deliberate: a distinct, precise "you're being
rate limited, try again in N seconds" response would let an attacker
deliberately trip the limiter to positively identify whether a given
target (email) is real, turning the defense into a new oracle. The
registration endpoint does return a `429` with `Retry-After` — safe there,
because it's already scoped per-IP/per-email in a way that doesn't
distinguish accounts by existence, and a hard block on excessive
*registration* volume is not itself sensitive information.

## 2. Session revocation

**Update (pre-Task-5 audit):** `jwtCallback` and `sessionCallback` are now
extracted as named, exported functions in `lib/auth.ts` (previously
inline in the `NextAuth({...})` call), with `jwtCallback` additionally
taking an optional injectable session-security-service dependency
(default: the real singleton) — the same DI pattern already used
throughout this codebase. This is a testability-only change with no
behavior difference; it exists specifically so
`tests/integration/sessionRevocation.test.ts` can call the real,
production `jwtCallback` directly and prove the full revoke → reject →
fresh-login-succeeds cycle end to end, against a live database, without
needing to simulate Auth.js's HTTP/cookie transport layer.

**Mechanism:** a `security_version` integer column on `User` (default 1).
A JWT embeds the security_version that was current at sign-in
(`token.securityVersion`). Every time `auth()` is called anywhere in the
app, `@auth/core` decodes the JWT and re-invokes `lib/auth.ts`'s `jwt`
callback, which calls `sessionSecurityService.isSessionValid(userId,
tokenSecurityVersion)` and returns `null` if either the version no longer
matches the database or the account is now suspended.
`revokeAllSessions(userId)` atomically increments `security_version`,
which immediately invalidates every session issued before that call.

**Why a security version, not a server-side session table:** unchanged
from the original review response — a full per-session table is the
conventional fix for JWT's revocation problem, but it's a materially
bigger structural change (effectively database-backed sessions, one of
the two things Task 3 deliberately avoided). A single integer column
achieves "revoke everything for this user, immediately" without that
larger change. It does not support revoking one session while leaving
others active — if that granularity is ever needed, that's the point to
introduce a real session table.

**Enforcement is now framework-wide, not convention-based.** This was
revised after the first hardening pass, which used a separate
`getValidatedSession()` wrapper and documented — honestly, at the time —
that bare `auth()` would NOT enforce revocation, out of uncertainty about
whether returning `null` from the `jwt` callback reliably propagates to
every way `auth()` gets called. That uncertainty has since been resolved
by reading the actual source of both packages:

- `@auth/core`'s session-read logic (`lib/actions/session.js`) decodes the
  JWT, calls `callbacks.jwt(...)`, and — this is the load-bearing line —
  when the callback returns `null`, it clears the session cookie
  (`sessionStore.clean()`) rather than building a session response.
- `next-auth`'s `auth()` implementation (`lib/index.js`) has exactly ONE
  code path for reading a session (`getSession()`), used identically by
  React Server Components, Route Handlers, Middleware, and API routes —
  every one of them calls into the same `@auth/core` session-read logic
  above. There's no separate, unaudited path any of them could take
  instead.
- `next-auth`'s own `parseSessionResponse` explicitly treats a `null`
  session body as "no session," and is itself the fix for a real,
  recently-disclosed CVE (GHSA-8fpg-xm3f-6cx3 / CVE-2026-73421 — a
  fail-open bug where certain error responses were previously
  mis-treated as a valid session). This project is already on the patched
  version (`5.0.0-beta.32`, verified in the earlier ecosystem review), so
  this fail-closed behavior is active.

Given that, the check now lives directly in the `jwt` callback in
`lib/auth.ts`, and `getValidatedSession()` has been removed — it's
redundant once `auth()` itself is trustworthy. **Task 4 and everything
after it can call plain `auth()` and get real revocation enforcement for
free, with no special function to remember.**

**Trade-offs, explicitly:**
- This reintroduces a database read to validate a session — the specific
  piece of JWT "statelessness" this project gives up — on **every**
  `auth()` call now, not just ones that opt into an extra wrapper. That's
  a deliberate widening from the first hardening pass, made because
  automatic, non-optional enforcement was judged more valuable than
  saving a lookup on the subset of calls that only needed "is someone
  signed in" for display purposes. It's one indexed primary-key lookup,
  not a join — if this becomes a measurable load concern, the place to
  optimize is caching `isSessionValid`'s result for a few seconds, not
  reverting to a convention-based wrapper.
- Nothing currently calls `revokeAllSessions()` in production code — no
  admin "suspend user" action exists yet (Task 4), and no password-change
  feature exists yet (§6). The status check inside `isSessionValid`
  already covers the concrete "suspended user's existing session"
  requirement on its own, automatically, the moment a suspension is
  written to the database — `revokeAllSessions()` exists as the
  general-purpose lever for forced invalidation that isn't a suspension
  (a future password-change or "log out everywhere" feature).

## 3. JWT / session lifetime

`session.maxAge` and `session.updateAge` are now explicit in `lib/auth.ts`
(previously relying on next-auth's undocumented default, confirmed via
research to be 30 days).

**Chosen defaults:** `maxAge` 12 hours, `updateAge` 1 hour (rolling — an
active session's expiry is pushed forward on use; a fully idle session
still expires on schedule). Reasoning: 12 hours is short enough to
meaningfully bound how long a leaked token stays useful, while being long
enough that someone actively using the platform for a work session isn't
forced to re-authenticate mid-task. This is explicitly an MVP judgment
call, not a formula — revisit once there's real usage data on session
patterns, or once Task 4 introduces roles (e.g. admin/institutional
sessions may warrant a shorter lifetime than buyer/seller browsing
sessions).

Both values are environment-configurable
(`AUTH_SESSION_MAX_AGE_SECONDS`, `AUTH_SESSION_UPDATE_AGE_SECONDS`), not
hard-coded — see `.env.example`.

## 4. AUTH_SECRET validation

`src/lib/env.ts` parses and validates all of this project's environment
configuration once, at import time (`loadEnv()`, exported as `env`),
failing fast and loudly rather than surfacing as a confusing runtime error
later.

**Production-only hard rejection** (throws, preventing the app from
starting) when `AUTH_SECRET`:
- is missing entirely,
- is shorter than 32 characters, or
- exactly matches one of a small set of known placeholder values
  (including this project's own `.env.example` default — the realistic
  failure mode is someone copying that file and forgetting to replace it).

**Deliberately not enforced outside production** — a short or placeholder
secret in development only logs nothing and doesn't block anything, so
local iteration stays frictionless.

**The secret's value is never included in any thrown error or log
line** — errors reference the environment variable by name only. This is
directly asserted by a test (see Testing section).

This is a best-effort safety net for the realistic failure mode (forgotten
placeholder), not an attempt to fully evaluate secret entropy/strength.

## 5. Registration / account enumeration

**Status: reverted to the original Task 3 behavior, by explicit product
decision.** This section originally documented changing
`POST /api/auth/register` from a `409 duplicate_email` response to a
generic response that didn't distinguish a new registration from an
already-registered email, closing a registration-side account-enumeration
gap. That change was reverted: `POST /api/auth/register` once again
returns `201` with the created user on success and `409 duplicate_email`
when the email is already registered.

**Why reverted:** for this MVP, immediate and unambiguous feedback to a
returning user ("you already have an account — log in instead") was
judged more valuable than closing the enumeration gap. This is a
considered trade-off, not an oversight or a regression nobody noticed:
an unauthenticated caller can still determine whether a given email has
an account by attempting to register with it. If that becomes a real
concern later (e.g. an institutional/compliance requirement, or evidence
of actual abuse), the fix is exactly the generic-response pattern this
was reverted from — it's a known, ready-to-reapply mitigation, not
something that needs to be redesigned from scratch.

**What was NOT reverted:** rate limiting on registration (per-email and
per-IP) stays exactly as implemented in §1 — that's an orthogonal
protection (bounds volume/abuse) independent of whether individual
responses distinguish new-vs-duplicate.

**Login-side enumeration protection remains fully intact and
unchanged**: `verifyCredentials` still throws the identical
`InvalidCredentialsError` for both "no such user" and "wrong password,"
still does the timing-mitigation dummy hash for the former case, and this
was not touched or weakened in any way during this reversal. The two
endpoints now deliberately have different postures: registration
prioritizes UX and accepts the enumeration signal; login has no UX reason
to make that trade and keeps the stronger protection.

## 6. Email/phone verification — readiness, not implementation

**Not built in this task, by instruction.** This section documents that
nothing here blocks building it later, and what will actually need to
change when it is.

**Nothing in the current schema or auth architecture prevents adding
verification.** `User.status` already has a `pending_verification` value
(unused today — see below); adding verification is additive:
- A new table (e.g. `VerificationToken`: token, user_id, purpose, expires_at)
  for single-use, expiring tokens — this is a purely additive migration,
  no existing table needs to change shape.
- Recommended: model email-verified and phone-verified as **separate,
  explicit timestamps** (`emailVerifiedAt`, `phoneVerifiedAt`, both
  nullable) rather than folding verification into `status`. `status`
  should keep meaning "is this account in good standing" (active /
  suspended); verification is a different axis (a suspended user could
  still have a verified email). Overloading `status` to mean both would
  make the suspension check in `sessionSecurityService` and
  `authService.verifyCredentials` more complicated for no benefit.

**What will need to change in this codebase specifically:**
- `authService.registerUser` currently hard-codes `status: "active"` at
  creation (with a comment explaining why — no verification flow exists
  to ever move a `pending_verification` account onward). Once
  verification exists, this should create accounts as
  `pending_verification` (or `active` with `emailVerifiedAt: null`,
  depending on which modeling approach is chosen above) and a
  verification email/SMS should be sent as part of registration.
- A **password reset flow** is a direct beneficiary of this: it cannot be
  built safely without a way to prove the requester controls the email
  address the reset is for — i.e., it has the same "prove you control this
  contact method" primitive as email verification, and should very likely
  share the same token table/mechanism (a `purpose: "password_reset"` vs.
  `purpose: "email_verification"` row, if the shared-table approach above
  is taken).
- A future password-reset flow should call
  `sessionSecurityService.revokeAllSessions(userId)` after a successful
  reset, so a compromised password can't keep an attacker's existing
  session alive after the legitimate owner resets it. The hook already
  exists and is ready to be called; nothing about it needs to change.
- No outbound email/SMS sending infrastructure exists in this project yet
  at all (no provider, no templates, no queue) — that's a prerequisite for
  verification and password reset both, and is its own scope of work
  beyond what's described here.

## Testing

See the Task 3 Hardening Report for the full list of what was tested and
how, including which pieces could be verified for real against a live
database in this environment and which remain blocked by the same
Prisma-engine network limitation documented in `prisma/README.md`.

## 7. Rate limiter abstraction — verified decoupled from Postgres

Confirmed by inspection: exactly one place in the entire codebase
references the concrete `postgresRateLimiter` implementation —
`authService.ts`'s `createAuthService()` default parameter
(`rateLimiter: RateLimiter = postgresRateLimiter`). Everything else
(`checkAndConsume`, the `register` route, `lib/auth.ts`'s `authorize()`)
depends only on the `RateLimiter` interface type, never the concrete
implementation. Swapping to Redis later means writing a `redisRateLimiter:
RateLimiter` satisfying the same `consume(key, max, windowMs)` contract
and changing that one default-parameter reference (or, more explicitly,
passing it in wherever `authService`'s production instance is
constructed) — no changes to business logic, route handlers, or tests
(the test suite already exercises this seam via `createFakeRateLimiter()`,
itself a third independent implementation of the same interface).
