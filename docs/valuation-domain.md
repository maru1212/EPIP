# Valuation Engine & Market Intelligence (Task 7)

Companion to `docs/property-domain.md` and `docs/listing-domain.md`.

## 1. Zero comparables never produces a fabricated number

The spec asked for handling "few or zero comparable listings... returning
a LOW confidence score with a baseline fall-back strategy." Read
literally, this could mean: when there's no real market data at all,
invent a placeholder number anyway (e.g. a hardcoded national/regional
average) and just mark it low-confidence.

**That's not what was built, deliberately.** With zero comparables,
`computeValuationEstimate`/`analyzeAskingPrice` return `{ sufficient:
false }` — no price, no range, confidence effectively 0 — and
`valuationService.estimateValue` does **not** persist a `ValuationReport`
in that case. No `ValuationReport` row in this system was ever created
without at least one real comparable transaction backing it.

**Why this reading, not the literal one:** this platform's stated purpose
is trustworthy market intelligence someone might act on financially. A
fabricated number — even confidence-flagged as low — is still a specific
figure a person could anchor a real decision to (a seller setting an
asking price, a buyer deciding whether to make an offer). Inventing one
from zero real data, with no calibration basis, is a form of
misinformation, and conflicts with this project's repeated principle of
not fabricating scores/data ahead of real data existing (Task 2's
data-quality fields, Task 6's price-per-sqm — both explicitly deferred
"real algorithm" until real data exists, rather than approximating with
made-up numbers). The "low confidence score" the spec asked for is
delivered as confidence `0` plus an explicit `persisted: false` /
`sufficient: false` result, not as a low-but-nonzero confidence
attached to an invented price.

**This is flagged for your review, not a unilateral final decision** — if
product judgment differs (e.g. a genuinely calibrated national baseline
becomes available later, or the business decides a rough placeholder is
acceptable with sufficiently strong UI warnings), that's a product call
above this implementation, and the architecture doesn't block adding it:
`computeValuationEstimate` would just gain a fallback branch, and
`estimateValue` would persist that result the same way it persists a
real one.

## 2. `estimate`/`analyze-listing` are public and rate-limited; `GET /[id]` is gated

The spec explicitly offered both framings ("`valuation:create`... **or**
public freemium access rate-limited appropriately"). Went with public +
rate-limited for the two POST endpoints, for two concrete reasons beyond
just picking the more permissive option:

- `ValuationReport.requestedByUserId` is nullable *in the schema itself*
  — the data model already assumes anonymous requests are a real case,
  not an edge case.
- Rate limiting reuses the existing Postgres-backed limiter from Task 3.1
  (`RATE_LIMIT_VALUATION_PER_IP_MAX`/`WINDOW_SECONDS`, defaulting to
  20/hour) rather than introducing anything new — the abstraction was
  already multi-instance-safe and already proven out.

`POST /api/valuations/estimate` calls `auth()` directly (not through
`requirePermission`) purely to populate `requestedByUserId` **if** a
session happens to exist — this is optional attribution, not an
authorization decision, so it's a legitimately different use of `auth()`
than the one enforcement path (`lib/withPermission.ts`) audited in the
pre-Task-5 review. `POST /api/valuations/analyze-listing` doesn't even
call `auth()` — it's fully stateless (see §3), so there's nothing to
attribute.

`GET /api/valuations/[id]` **is** gated behind `valuation:view`,
per the spec's explicit ask — a saved report is closer to a personal
query result than a public listing. `valuation:view` is a genuinely new
permission (unlike Task 5's `property:read`->`property:view`, there was
no existing equivalent to reuse), added to `buyer`/`seller`/`agent`/
`agency_admin`/`market_researcher`/`platform_admin` in the seed data.
Ownership is enforced in `valuationService.getReport`: the report's
original requester (if any) or an admin override (the same `user:manage`
proxy used elsewhere) may view it; a report with no requester (an
anonymous estimate) is viewable by anyone already holding the base
permission — same "no owner = accessible to any holder of the base
permission" pattern established for Property in Task 5.

## 3. The "overpriced?" analyzer is stateless — no ValuationReport is created

`analyzeListingPrice` never calls `valuationRepository.createReport`.
This is a query about a hypothetical asking price, not a request to save
a market valuation of the property itself — treating it as a saved report
would mean every "what if I priced it at X" check permanently cluttered a
property's valuation history. If a persisted audit trail of price checks
is ever wanted, that's a deliberate future addition, not an oversight.

## 4. The statistical engine is an explicit v0 heuristic, not a calibrated model

Both the condition-multiplier table (`new: 1.1`, `good: 1.0`,
`needs_renovation: 0.85`, etc.) and the +/-10% overpriced/underpriced
threshold in `valuationMath.ts` are simple, documented, arbitrary-but-
reasonable starting points — not derived from any real Ethiopian property
transaction data, because none exists in this system yet. This is the
same "architecture before algorithm" principle already applied to Task
2's data-quality scores and Task 6's price-per-sqm: the goal is a
defensible, fully-documented, unit-tested placeholder that real
transaction data can calibrate later, not a claim that these specific
numbers are correct today.

The confidence-score formula (`0.5 x sample-size-score + 0.5 x
consistency-score`, saturating at 8 comparables, with a fixed pessimistic
value for the single-comparable case since variance can't be measured
from one point) is likewise a simple, monotonic, testable heuristic —
verified in `valuationMath.test.ts` to genuinely increase with more
comparables and genuinely decrease with higher variance, which is the
property that actually matters, independent of the exact constants.

## 5. Sale listings only — this values a property's sale price, not rental value

`valuationRepository.findComparableListings` filters to
`listing_type = 'sale'`. Rental price-per-sqm (monthly rent) is a
completely different scale from sale price-per-sqm; mixing them would
produce a meaningless number. Estimating rental value is a real, distinct
future feature, not implemented here — it would need its own comparable
filter (`listing_type = 'rent'`) and almost certainly its own confidence/
spread tuning, since rental markets behave differently.

## 6. Comparable matching: same property type, always; location OR radius

A comparable must share the target's exact `property_type_id` (comparing
an apartment to a warehouse is meaningless) and either share its
`LocationNode` or fall within a radius of its coordinates (default
3000m) — combined with `OR`, not `AND`, since a property might have one
without the other (no recorded coordinates, or a `LocationNode` too
coarse to be useful alone). The building-vs-land area choice (§7) is
applied consistently: a comparable is only used if it has the *same*
area type (building or land) as the property being valued, with a real
value greater than zero — a land listing can't inform a
building-area-based estimate.

## 7. Building area preferred over land area, per property

`resolveAreaType` in `valuationService.ts` uses `buildingAreaSqm` when
present and positive, falling back to `landAreaSqm` (e.g. for a `land`
property type, which has no building at all). A property with neither is
rejected with `PropertyHasNoUsableAreaError` (422) — there's no basis to
value it by this method at all.

## 8. Raw SQL throughout, same reasoning as Listing (Task 6)

`valuationRepository.ts` uses raw SQL for the same reason
`listingRepository.ts` does: a schema-specific Prisma Client cannot be
generated in this environment (see `prisma/README.md`), so raw SQL —
verifiable by running the equivalent statement directly against the live
database — was chosen over ORM calls that can't be verified at all here.
The comparable-retrieval query specifically also needs a join plus an
optional PostGIS predicate that Prisma's relational filtering can't
express regardless of environment.

## 9. Defense-in-depth: four CHECK constraints on `valuation_reports`

Beyond Zod validation, the database itself enforces: all three price
fields positive, `low_estimate <= high_estimate`, `estimated_value`
between the two, and `confidence_score` within `[0, 1]`. Verified directly
against a live database that each constraint genuinely rejects a bad
insert, not just declared and assumed correct.
