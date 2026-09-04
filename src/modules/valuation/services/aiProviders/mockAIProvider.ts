import type {
  AIValuationProvider,
  NarrativeGenerationInput,
  NarrativeGenerationOutput,
} from "./aiProvider";

/**
 * The default provider — genuinely functional (not a stub that just
 * returns fixed strings), producing narrative text that actually reflects
 * the specific input's numbers, deterministically and without any
 * external network call or API key. This is what makes local development
 * and this project's test suite work without any AI provider configured,
 * per the Task 10 spec's explicit requirement.
 *
 * "Deterministic" here means: the same input always produces the same
 * output. This matters for tests (assertions on exact wording) and for
 * not needing network access to develop or test this feature at all.
 */
export const mockAIProvider: AIValuationProvider = {
  name: "mock",

  async generateNarrative(
    input: NarrativeGenerationInput
  ): Promise<NarrativeGenerationOutput> {
    const location = input.locationChain[0] ?? "this area";
    const fullLocation = input.locationChain.join(", ") || "Ethiopia";

    const pricePerSqm =
      input.buildingAreaSqm !== null && input.buildingAreaSqm > 0
        ? input.estimatedValue / input.buildingAreaSqm
        : input.landAreaSqm !== null && input.landAreaSqm > 0
          ? input.estimatedValue / input.landAreaSqm
          : null;

    const comparisonToMedian =
      pricePerSqm !== null && input.medianComparablePricePerSqm !== null
        ? ((pricePerSqm - input.medianComparablePricePerSqm) /
            input.medianComparablePricePerSqm) *
          100
        : null;

    const executiveSummary =
      `This ${input.propertyTypeKey} in ${fullLocation} is estimated at ` +
      `${Math.round(input.estimatedValue).toLocaleString()} ${input.currency}, ` +
      `within a range of ${Math.round(input.lowEstimate).toLocaleString()}-` +
      `${Math.round(input.highEstimate).toLocaleString()} ${input.currency}. ` +
      (comparisonToMedian !== null
        ? `This places it approximately ${Math.abs(Math.round(comparisonToMedian))}% ` +
          `${comparisonToMedian >= 0 ? "above" : "below"} the median price per square meter ` +
          `among comparable properties in the area.`
        : `Limited comparable data was available to benchmark this precisely against the local median.`);

    const locationAnalysis =
      `${location} is one of the named subcities/areas tracked in this platform's location ` +
      `hierarchy. ` +
      (input.comparableCount > 0
        ? `${input.comparableCount} comparable active listing${input.comparableCount === 1 ? "" : "s"} ` +
          `near this property informed the estimate, suggesting an active market in the immediate area.`
        : `No comparable listings were available in the immediate area, limiting location-specific insight.`);

    const pricingFactors =
      `The primary driver of this estimate is the comparable-sales median price per square meter` +
      (input.medianComparablePricePerSqm !== null
        ? ` of ${Math.round(input.medianComparablePricePerSqm).toLocaleString()} ${input.currency}/sqm`
        : "") +
      `, adjusted for this property's condition` +
      (input.condition ? ` (recorded as "${input.condition}")` : " (not recorded)") +
      `. ` +
      (input.coefficientOfVariation !== null && input.coefficientOfVariation > 0.3
        ? `Comparable prices in the area show notable variability, which widens the estimated range.`
        : `Comparable prices in the area are relatively consistent, supporting a tighter estimated range.`);

    const confidenceExplanation =
      `The confidence score of ${input.confidenceScore.toFixed(2)} reflects ` +
      `${input.comparableCount} comparable listing${input.comparableCount === 1 ? "" : "s"}` +
      (input.coefficientOfVariation !== null
        ? ` with a price coefficient of variation of ${(input.coefficientOfVariation * 100).toFixed(1)}%. ` +
          (input.coefficientOfVariation > 0.3
            ? "Higher variability among comparables reduces confidence."
            : "Low variability among comparables supports higher confidence.")
        : ` — with only one comparable, variability cannot be measured, which caps confidence regardless of the single data point's consistency.`);

    return { executiveSummary, locationAnalysis, pricingFactors, confidenceExplanation };
  },
};
