# valuation module

Automated market valuations and price analysis for a Property, based on
comparable active sale listings.

Implemented (Task 7): `ValuationReport` schema (estimate/range/confidence,
methodology, audit-trail JSONB fields), a repository
(`repositories/valuationRepository.ts` — comparable retrieval via a
location-or-spatial join to `properties`/`listings`, plus report CRUD),
and a service layer (`services/valuationService.ts` — rate-limited public
estimation, the stateless "is this overpriced?" analyzer, and
report-ownership enforcement). The actual statistics live in
`services/valuationMath.ts` as pure, independently-testable functions.

See `docs/valuation-domain.md` for decisions and flagged trade-offs —
most importantly, that a zero-comparable case never produces a fabricated
price (returns "insufficient data" instead), which is a considered
interpretation of the original spec worth your explicit awareness.

Implemented (Task 10): AI-enriched narrative reports on top of the
statistical engine — `services/aiValuationService.ts` orchestrates the
existing statistical estimate plus an optional, resilient narrative
layer via a pluggable provider adapter (`services/aiProviders/`,
defaulting to a real, deterministic mock requiring no API key). Any AI
failure falls back to the plain statistical report (`aiEnriched: false`),
never a thrown error. See `docs/ai-valuation-domain.md`.

No cost-approach or hybrid methodology, and no professional/manual
valuer workflow yet.
