import { describe, expect, it } from "vitest";
import { mockAIProvider } from "@/modules/valuation/services/aiProviders/mockAIProvider";
import type { NarrativeGenerationInput } from "@/modules/valuation/services/aiProviders/aiProvider";

function makeInput(overrides: Partial<NarrativeGenerationInput> = {}): NarrativeGenerationInput {
  return {
    propertyId: "prop-1",
    estimatedValue: 5_000_000,
    lowEstimate: 4_500_000,
    highEstimate: 5_500_000,
    confidenceScore: 0.75,
    medianComparablePricePerSqm: 50_000,
    comparableCount: 4,
    coefficientOfVariation: 0.1,
    propertyTypeKey: "apartment",
    locationChain: ["Bole", "Addis Ababa"],
    bedrooms: 3,
    buildingAreaSqm: 100,
    landAreaSqm: null,
    condition: "good",
    currency: "ETB",
    ...overrides,
  };
}

describe("mockAIProvider.generateNarrative", () => {
  it("returns all four required structured fields as non-empty strings", async () => {
    const result = await mockAIProvider.generateNarrative(makeInput());

    expect(typeof result.executiveSummary).toBe("string");
    expect(result.executiveSummary.length).toBeGreaterThan(0);
    expect(typeof result.locationAnalysis).toBe("string");
    expect(result.locationAnalysis.length).toBeGreaterThan(0);
    expect(typeof result.pricingFactors).toBe("string");
    expect(result.pricingFactors.length).toBeGreaterThan(0);
    expect(typeof result.confidenceExplanation).toBe("string");
    expect(result.confidenceExplanation.length).toBeGreaterThan(0);
  });

  it("is deterministic: identical input produces identical output", async () => {
    const input = makeInput();
    const first = await mockAIProvider.generateNarrative(input);
    const second = await mockAIProvider.generateNarrative(input);

    expect(first).toEqual(second);
  });

  it("reflects the actual numbers in the input, not fixed boilerplate", async () => {
    const cheap = await mockAIProvider.generateNarrative(
      makeInput({ estimatedValue: 1_000_000, lowEstimate: 900_000, highEstimate: 1_100_000 })
    );
    const expensive = await mockAIProvider.generateNarrative(
      makeInput({ estimatedValue: 50_000_000, lowEstimate: 45_000_000, highEstimate: 55_000_000 })
    );

    expect(cheap.executiveSummary).toContain("1,000,000");
    expect(expensive.executiveSummary).toContain("50,000,000");
    expect(cheap.executiveSummary).not.toEqual(expensive.executiveSummary);
  });

  it("reflects the location chain", async () => {
    const bole = await mockAIProvider.generateNarrative(
      makeInput({ locationChain: ["Bole", "Addis Ababa"] })
    );
    const yeka = await mockAIProvider.generateNarrative(
      makeInput({ locationChain: ["Yeka", "Addis Ababa"] })
    );

    expect(bole.locationAnalysis).toContain("Bole");
    expect(yeka.locationAnalysis).toContain("Yeka");
  });

  it("handles a single comparable (no measurable variance) without crashing", async () => {
    const result = await mockAIProvider.generateNarrative(
      makeInput({ comparableCount: 1, coefficientOfVariation: null })
    );
    expect(result.confidenceExplanation.length).toBeGreaterThan(0);
  });

  it("handles zero comparables gracefully", async () => {
    const result = await mockAIProvider.generateNarrative(
      makeInput({
        comparableCount: 0,
        coefficientOfVariation: null,
        medianComparablePricePerSqm: null,
      })
    );
    expect(result.executiveSummary.length).toBeGreaterThan(0);
    expect(result.locationAnalysis.length).toBeGreaterThan(0);
  });

  it("handles a land property (buildingAreaSqm null, landAreaSqm set)", async () => {
    const result = await mockAIProvider.generateNarrative(
      makeInput({ buildingAreaSqm: null, landAreaSqm: 300, propertyTypeKey: "land" })
    );
    expect(result.executiveSummary.length).toBeGreaterThan(0);
  });

  it("reports higher variability language for high coefficient of variation", async () => {
    const consistent = await mockAIProvider.generateNarrative(
      makeInput({ coefficientOfVariation: 0.05 })
    );
    const variable = await mockAIProvider.generateNarrative(
      makeInput({ coefficientOfVariation: 0.5 })
    );

    expect(consistent.pricingFactors).toContain("consistent");
    expect(variable.pricingFactors).toContain("variability");
  });
});
