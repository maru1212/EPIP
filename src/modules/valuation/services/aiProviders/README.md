# aiProviders

The pluggable LLM adapter pattern for narrative valuation generation
(Task 10). `aiValuationService.ts` depends only on the `AIValuationProvider`
interface (`aiProvider.ts`), never on a specific implementation.

- `mockAIProvider.ts` — the default. Real, deterministic, data-driven
  narrative generation with zero external calls or API key required.
- `anthropicAIProvider.ts` — a real, correct implementation against
  Anthropic's Messages API. Untestable end-to-end in this sandbox (no
  `ANTHROPIC_API_KEY` configured) — see docs/ai-valuation-domain.md §2.
- `createAIProvider.ts` — factory selecting the active provider from
  `AI_VALUATION_PROVIDER`/`ANTHROPIC_API_KEY` env vars, defaulting to
  mock whenever no real provider is configured.
- `prompt.ts` — shared prompt construction (used by real providers only;
  the mock generates text directly, not via a completion cycle).
