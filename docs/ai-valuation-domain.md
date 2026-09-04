# AI-Powered Valuation Intelligence & Narrative AVM Reports (Task 10)

Companion to `docs/valuation-domain.md` and the other domain docs.

## 1. `valuation:create` is a genuinely new permission, distinct from the free statistical estimate

`POST /api/valuations/estimate` (Task 7) is deliberately public and
rate-limited — that decision stands, unchanged. `POST /api/valuations/
ai-report` gates behind a new `valuation:create` permission because
generating the AI-enriched narrative is a materially heavier, costlier
operation (an LLM call, even against the mock provider's more modest
compute cost) than a pure statistical lookup. Granted to the same role
set as `valuation:view` (buyer, seller, agent, agency_admin,
market_researcher, platform_admin) — if you can view a saved report, you
can generate the enriched version of one.

## 2. The adapter pattern has one genuinely functional provider (mock) and one genuinely correct, but untestable-here, provider (Anthropic)

`mockAIProvider.ts` is not a stub that returns fixed strings — verified
directly that it produces narrative text that actually reflects the
specific input's numbers (estimated value, comparable count, variability,
condition), deterministically, with zero external calls or API key. This
is what makes the whole feature — and this project's test suite — work
with zero AI configuration, per the spec's explicit requirement.

`anthropicAIProvider.ts` is real, correct code against Anthropic's actual
Messages API (correct request shape, response parsing, defensive
markdown-fence stripping, structured-output validation) — but cannot be
exercised end-to-end in this sandbox. There is no `ANTHROPIC_API_KEY`
configured here, and making real, billed API calls as part of
building/testing this feature would not be appropriate without explicit
authorization, even though this sandbox's network allowlist happens to
include `api.anthropic.com`. Same category of "correct but
environment-limited" code that recurs throughout this project (Prisma
Client generation being the other major example).

## 3. Resilience: a service-level timeout wraps every provider call, not just the ones with their own internal timeout

`withTimeout()` in `aiValuationService.ts` races the provider call
against a hard deadline (`AI_VALUATION_TIMEOUT_MS`, default 10s),
independent of whatever a specific provider does internally — the
Anthropic provider additionally has its own `AbortController`-based HTTP
timeout, but a hypothetical future provider with no internal timeout
protection still can't hang a request indefinitely. Verified with a test
that makes the (mocked) provider simply never resolve, confirming the
service still returns within the timeout window rather than hanging.

Every failure mode — provider error, timeout, malformed/unparseable
response, even the property having disappeared between the statistical
step and enrichment — funnels through the same catch block and returns
the already-successful statistical report with `aiEnriched: false`. The
one case this can't paper over is `persisted: false` (no usable
comparable data at all for the *statistical* step) — there's no report
to enrich or return in that case, same as the plain estimate endpoint.

## 4. `GET /api/valuations/[id]/ai-summary` reuses `valuationService.getReport`'s ownership check, not a duplicate

The AI summary endpoint doesn't reimplement "is this the report's
requester, or an admin" — it calls the exact same, already-tested
`getReport` method Task 7 built, and shapes the narrative out of
whatever it returns. This means a report's AI narrative is exactly as
protected as the report itself, by construction, not by two separately
maintained authorization checks that could drift apart.

## 5. A report that exists but has no AI narrative returns 200, not 404

`aiEnriched: false` with the plain report is a normal, non-error outcome
— a report can legitimately have never been AI-enriched (created via the
plain `/estimate` endpoint), or had enrichment attempted and fall back.
404 is reserved for the underlying `ValuationReport` id not existing at
all. This is the same "don't treat missing enrichment as an error"
philosophy as the resilience contract itself.

## 6. JSONB enrichment merges into existing `valuationData`, verified not to lose data

`valuationRepository.updateAiEnrichment` uses Postgres's `||` JSONB
concatenation (`COALESCE(valuation_data, '{}'::jsonb) || $2::jsonb`), not
an overwrite. Verified directly against a live database: a report
created with statistical fields (`medianPricePerSqm`, `comparableCount`,
etc.) still has every one of those fields intact after AI enrichment is
merged in, and re-running enrichment a second time (e.g. regenerating a
report) correctly replaces the narrative while still preserving the
original statistical data untouched by either enrichment call.

## 7. Location context uses a full ancestor-chain lookup, not just the immediate node

`getLocationChain` (in `aiValuationService.ts`) uses a `WITH RECURSIVE`
query walking up `LocationNode.parentId`, returning names most-specific-
first (e.g. `["Bole", "Addis Ababa"]`) — giving the AI provider genuine
hierarchical context rather than just an isolated neighborhood name with
no city-level context. Verified against a real 2-level hierarchy, and
against a single node with no parent (returns just that one name, not an
error).

## 8. The Ethiopian market context in the prompt is general public knowledge, not proprietary data

`prompt.ts`'s `ETHIOPIAN_MARKET_CONTEXT` block (Bole/Yeka/Nifas Silk
characteristics, ETB inflation, leasehold land tenure) is framed to the
model explicitly as general context to reason with, not verified facts
about the specific property being valued — this platform has no
per-neighborhood proprietary dataset to draw from yet. The mock provider
doesn't use this prompt at all (it has no completion cycle to send a
prompt through); it's used only by the real Anthropic provider.

## 9. A newly-discovered npm/environment issue, found and properly fixed, not routed around

Mid-task, a clean-install verification hit a genuine `npm` 10.9.7
internal bug (`Cannot read properties of null (reading 'edgesOut')`) in
its dependency-resolution logic (`@npmcli/arborist`), unrelated to any
change made in this task. The obvious workaround, `--legacy-peer-deps`,
was tested and rejected: it silently produced a **broken** install
(`@testing-library/dom`, a required peer dependency, was missing
entirely, since `--legacy-peer-deps` reverts to not auto-installing
peers). Root-caused instead: upgrading the global `npm` tool to 12.0.2
resolved the underlying resolver bug correctly — but surfaced a second,
related issue (npm 12's new default script-blocking security feature
silently prevented `@prisma/client`'s postinstall script from creating
even the minimal client stub this whole project has depended on).
Explicitly approved the legitimate packages' install scripts
(`@prisma/client`, `@prisma/engines`, `prisma`, `argon2`, and three
transitive Next.js/build-tooling packages) rather than disabling the
security feature wholesale, then verified `argon2`'s native binding
still genuinely works (a real hash/verify round-trip) before trusting
the fix. This is project/environment-tooling maintenance, not a change
to this project's own code or architecture.
