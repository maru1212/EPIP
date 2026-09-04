import type { NarrativeGenerationInput } from "./aiProvider";

/**
 * Shared by real LLM-backed providers (currently just Anthropic) — the
 * mock provider doesn't need a prompt string since it generates
 * structured text directly from the input, not via a completion call.
 *
 * The Ethiopian-market context below is deliberately general public
 * knowledge (well-known characteristics of Addis Ababa's subcities), not
 * a claim of proprietary market data this platform has collected — this
 * project has no per-neighborhood dataset to draw from yet. Framed to
 * the model as general context to reason with, not as verified facts
 * about the specific property being valued.
 */
const ETHIOPIAN_MARKET_CONTEXT = `
General context on the Addis Ababa property market (general public
knowledge, not verified data about this specific property):
- Bole is a commercial and diplomatic hub near the airport, generally
  commanding a premium for proximity to international offices, hotels,
  and Bole Road's retail corridor.
- Yeka has a mix of established and newly-developing residential areas,
  with value varying significantly by exact sub-area and road access.
- Nifas Silk-Lafto includes both older, denser neighborhoods and newer
  planned developments; industrial zoning in parts of it can affect
  residential desirability.
- Construction quality varies widely: reinforced concrete-frame
  buildings with quality finishing generally command a premium over
  older or informally-constructed stock.
- The Ethiopian Birr (ETB) has experienced significant depreciation and
  inflation in recent years; property is often viewed as a store of
  value, which can support prices independent of pure rental yield.
- Land tenure in Ethiopia is leasehold (all land is state-owned), which
  affects how "land value" should be understood compared to freehold
  markets.
`.trim();

export function buildValuationNarrativePrompt(input: NarrativeGenerationInput): string {
  const location = input.locationChain.join(", ") || "an unspecified location in Ethiopia";
  const areaDescription =
    input.buildingAreaSqm !== null
      ? `${input.buildingAreaSqm} sqm of building area`
      : input.landAreaSqm !== null
        ? `${input.landAreaSqm} sqm of land area`
        : "an unspecified area";

  return `
You are a real estate market analyst writing a narrative valuation report
for a property in Ethiopia. You will be given a statistical valuation
already computed from comparable sales — your job is to explain and
contextualize it in plain language, not to recompute or second-guess the
numbers.

${ETHIOPIAN_MARKET_CONTEXT}

Property being valued:
- Type: ${input.propertyTypeKey}
- Location: ${location}
- Size: ${areaDescription}
- Bedrooms: ${input.bedrooms ?? "not recorded"}
- Condition: ${input.condition ?? "not recorded"}

Statistical valuation already computed (do not recalculate — explain it):
- Estimated value: ${input.estimatedValue.toLocaleString()} ${input.currency}
- Range: ${input.lowEstimate.toLocaleString()} - ${input.highEstimate.toLocaleString()} ${input.currency}
- Confidence score: ${input.confidenceScore} (0-1 scale)
- Based on ${input.comparableCount} comparable active listing(s)
- Median comparable price per sqm: ${
    input.medianComparablePricePerSqm !== null
      ? `${input.medianComparablePricePerSqm.toLocaleString()} ${input.currency}/sqm`
      : "not available"
  }
- Comparable price variability (coefficient of variation): ${
    input.coefficientOfVariation !== null ? input.coefficientOfVariation : "not available (single comparable)"
  }

Respond with ONLY a JSON object (no markdown fences, no other text) with
exactly these four string fields:
{
  "executiveSummary": "A 2-3 sentence high-level summary of the property's market position.",
  "locationAnalysis": "2-3 sentences on the micro-location's qualitative factors.",
  "pricingFactors": "2-3 sentences on what is driving the estimate up or down.",
  "confidenceExplanation": "1-2 sentences explaining, in plain language, why the confidence score is what it is, based on the sample size and variability above."
}
`.trim();
}
