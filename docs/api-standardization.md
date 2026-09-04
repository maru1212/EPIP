# API Standardization, OpenAPI Specs & Integration Polish (Task 9)

Companion to `docs/property-domain.md`, `docs/listing-domain.md`,
`docs/valuation-domain.md`, and `docs/search-and-b2b-domain.md`.

## 1. `withPermission.ts` retrofitted too — not in the literal route list, but load-bearing

The spec's retrofit list named 8 specific route files. It didn't mention
`src/lib/withPermission.ts` — the shared RBAC guard every gated route in
the app depends on for its 401/403 responses. Before this task, it
returned a bare `Response.json({ error: "forbidden", ... })`, not the
standardized envelope. Retrofitting the 8 listed routes without also
fixing this would have left the single most common error case across
the *entire* API (permission failures) inconsistent — including on
Task 8's B2B routes, which weren't otherwise touched by this task at all.
Fixed it as a necessary consequence of the stated goal, not scope creep.

## 2. `/api/valuations/analyze-listing` retrofitted too

Not individually bulleted under item 1's route list, but "all existing
endpoints from Tasks 5, 6, and 7" implies it — leaving it inconsistent
with its sibling `/api/valuations/estimate` would have been a strange
half-measure. See `docs/valuation-domain.md` for that endpoint's own
design notes, unaffected by this retrofit beyond the response shape.

## 3. Prisma error detection is duck-typed, not `instanceof`

Verified directly (see `src/lib/errorBoundary.ts`'s header comment):
`Prisma.PrismaClientKnownRequestError` is `undefined` at runtime in this
sandbox — the un-generated Prisma Client stub doesn't expose it, even
though the type declaration exists. An `instanceof` check against
`undefined` throws rather than just failing to match. Checking for the
documented shape (`{ name: "PrismaClientKnownRequestError", code,
clientVersion }`) instead works correctly in both this sandbox and a
real generated-client environment, since that's the exact shape Prisma's
own type declares — and keeps this module correct without needing a real
`@prisma/client` import at all, consistent with this project's raw-SQL
repositories already not depending on the generated client for anything
else.

## 4. Only P2002/P2025/P2003 get specific handling; everything else is generic

Prisma has several dozen documented error codes, covering connection
issues, query-engine internals, and more. Per the spec's explicit list,
only unique-constraint (P2002 -> 409), record-not-found (P2025 -> 404),
and foreign-key violations (P2003 -> 409) get specific client-facing
codes. Every other Prisma error code — and every non-Prisma unexpected
error — falls through to a single generic, sanitized `internal_error`/
`database_error` 500. The real error is always logged server-side via
`console.error` first; only the client-facing response is sanitized.
Verified with a test that constructs a Prisma-shaped error carrying a
real-looking connection string and credentials, and confirms neither
appears anywhere in the response body — only in the server log.

## 5. Response-envelope inconsistency from Task 8 is now resolved for Tasks 5-7

Task 8's own documentation (`docs/search-and-b2b-domain.md` §1) flagged
that its new standardized envelope wasn't retrofitted onto Property/
Listing/Valuation routes, calling it "a real, acknowledged inconsistency."
This task closes that gap for exactly those routes (plus
`withPermission.ts`, per §1 above). `/api/openapi.json` remains a
deliberate, standard exception (see §7) — OpenAPI tooling expects the raw
spec document, not a wrapped envelope.

## 6. OpenAPI spec: code-first, complete at the route level, not exhaustive at the field level

`src/lib/openapi/spec.ts` documents every real path, method, security
requirement, and standard status code (400/401/403/404/409/422/429) in
the application — verified by a test that walks every expected path and
confirms it's present, and by tests confirming public vs. gated
endpoints carry the correct `security` requirement. It does **not**
attempt a byte-for-byte JSON Schema of every nested domain object (e.g.
every field Property can have) — that would be a much larger, lower-value
effort for a project at this stage. Request/response bodies are
representative, not exhaustive.

## 7. The Bearer-JWT security scheme is a documented simplification

This API's real session mechanism is an httpOnly cookie set by Auth.js
after login — not a client-presented `Authorization: Bearer <token>`
header. The Task 9 spec explicitly asked for protected endpoints to be
documented as requiring "Bearer JWT authentication," so the spec's
`bearerAuth` security scheme reflects that framing, with an explicit note
(in both the spec file and the scheme's own `description` field) that a
strictly accurate spec would instead use an `apiKey`-type scheme with
`in: cookie`. Worth revisiting if this spec is ever used to generate a
real API client, since a generated client would send a header this API
doesn't actually check.

## 8. `GET /api/openapi.json` is intentionally NOT wrapped in the envelope

A deliberate, standard exception, not an oversight: Swagger UI, Redoc,
and OpenAPI client generators all expect the raw specification document
at this kind of endpoint. Wrapping it in `{ success, data }` would break
every one of them. `GET /api/docs` (the interactive Swagger UI page)
likewise returns raw HTML, not JSON at all.

## 9. Swagger UI is loaded from a CDN, not an added npm dependency

Consistent with this project's general minimal-dependency preference.
`/api/docs` is purely presentational — it renders whatever
`/api/openapi.json` returns; nothing server-side depends on the Swagger
UI package itself, so a CDN script/stylesheet is a reasonable choice over
adding `swagger-ui-react`/`swagger-ui-dist` as a project dependency.

## 10. Both docs endpoints are public, ungated, unrate-limited

API documentation describing protected endpoints doesn't itself need
protecting — the same reasoning already established for Property/Listing
public GETs, just applied to documentation rather than domain data.
