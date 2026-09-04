import { describe, expect, it } from "vitest";
import {
  computeValuationEstimate,
  analyzeAskingPrice,
  conditionMultiplier,
} from "@/modules/valuation/services/valuationMath";

describe("computeValuationEstimate", () => {
  it("returns insufficient data for zero comparables, without fabricating a number", () => {
    const result = computeValuationEstimate({
      comparablePricesPerSqm: [],
      targetAreaSqm: 100,
      condition: "good",
    });
    expect(result.sufficient).toBe(false);
    expect(result.comparableCount).toBe(0);
  });

  it("produces a low, but nonzero, confidence score for a single comparable", () => {
    const result = computeValuationEstimate({
      comparablePricesPerSqm: [50_000],
      targetAreaSqm: 100,
      condition: "good",
    });
    expect(result.sufficient).toBe(true);
    if (result.sufficient) {
      expect(result.comparableCount).toBe(1);
      expect(result.confidenceScore).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeLessThan(0.3);
      expect(result.coefficientOfVariation).toBeNull(); // can't measure variance with n=1
    }
  });

  it("scales confidence up with more comparables at the same (low) variance", () => {
    const fewConsistent = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_100],
      targetAreaSqm: 100,
      condition: "good",
    });
    const manyConsistent = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_100, 49_900, 50_050, 49_950, 50_020, 49_980, 50_010],
      targetAreaSqm: 100,
      condition: "good",
    });

    expect(fewConsistent.sufficient).toBe(true);
    expect(manyConsistent.sufficient).toBe(true);
    if (fewConsistent.sufficient && manyConsistent.sufficient) {
      expect(manyConsistent.confidenceScore).toBeGreaterThan(fewConsistent.confidenceScore);
    }
  });

  it("scales confidence down with higher variance at the same sample size", () => {
    const consistent = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_100, 49_900, 50_050, 49_950, 50_020, 49_980, 50_010],
      targetAreaSqm: 100,
      condition: "good",
    });
    const variable = computeValuationEstimate({
      comparablePricesPerSqm: [20_000, 80_000, 30_000, 70_000, 25_000, 75_000, 40_000, 60_000],
      targetAreaSqm: 100,
      condition: "good",
    });

    expect(consistent.sufficient).toBe(true);
    expect(variable.sufficient).toBe(true);
    if (consistent.sufficient && variable.sufficient) {
      expect(consistent.confidenceScore).toBeGreaterThan(variable.confidenceScore);
      // Wider variance should also produce a wider low/high spread.
      const consistentSpread = consistent.highEstimate - consistent.lowEstimate;
      const variableSpread = variable.highEstimate - variable.lowEstimate;
      expect(variableSpread).toBeGreaterThan(consistentSpread);
    }
  });

  it("keeps confidenceScore within [0, 1] and low <= estimated <= high across many scenarios", () => {
    const scenarios: number[][] = [
      [1],
      [100, 200],
      [1, 1_000_000],
      Array.from({ length: 20 }, (_, i) => 40_000 + i * 500),
    ];
    for (const prices of scenarios) {
      const result = computeValuationEstimate({
        comparablePricesPerSqm: prices,
        targetAreaSqm: 80,
        condition: null,
      });
      expect(result.sufficient).toBe(true);
      if (result.sufficient) {
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(result.confidenceScore).toBeLessThanOrEqual(1);
        expect(result.lowEstimate).toBeLessThanOrEqual(result.estimatedValue);
        expect(result.estimatedValue).toBeLessThanOrEqual(result.highEstimate);
        expect(result.lowEstimate).toBeGreaterThan(0);
      }
    }
  });

  it("applies the condition multiplier to the estimate", () => {
    const goodCondition = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_000, 50_000],
      targetAreaSqm: 100,
      condition: "good",
    });
    const newCondition = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_000, 50_000],
      targetAreaSqm: 100,
      condition: "new",
    });
    const needsRenovation = computeValuationEstimate({
      comparablePricesPerSqm: [50_000, 50_000, 50_000],
      targetAreaSqm: 100,
      condition: "needs_renovation",
    });

    expect(goodCondition.sufficient && newCondition.sufficient && needsRenovation.sufficient).toBe(
      true
    );
    if (goodCondition.sufficient && newCondition.sufficient && needsRenovation.sufficient) {
      expect(newCondition.estimatedValue).toBeGreaterThan(goodCondition.estimatedValue);
      expect(needsRenovation.estimatedValue).toBeLessThan(goodCondition.estimatedValue);
    }
  });

  it("treats an unrecognized/null condition as the neutral (1.0) multiplier", () => {
    expect(conditionMultiplier(null)).toBe(1.0);
    expect(conditionMultiplier("not-a-real-condition")).toBe(1.0);
    expect(conditionMultiplier("good")).toBe(1.0);
  });
});

describe("analyzeAskingPrice", () => {
  it("returns insufficient data for zero comparables", () => {
    const result = analyzeAskingPrice({
      askingPrice: 5_000_000,
      targetAreaSqm: 100,
      comparablePricesPerSqm: [],
    });
    expect(result.sufficient).toBe(false);
  });

  it("classifies a price well above the comparable median as overpriced", () => {
    const result = analyzeAskingPrice({
      askingPrice: 8_000_000, // 80,000/sqm vs ~50,000/sqm median
      targetAreaSqm: 100,
      comparablePricesPerSqm: [50_000, 51_000, 49_500, 50_500],
    });
    expect(result.sufficient).toBe(true);
    if (result.sufficient) {
      expect(result.assessment).toBe("overpriced");
      expect(result.percentageDifference).toBeGreaterThan(10);
    }
  });

  it("classifies a price near the comparable median as fairly priced", () => {
    const result = analyzeAskingPrice({
      askingPrice: 5_050_000, // 50,500/sqm vs ~50,250/sqm median
      targetAreaSqm: 100,
      comparablePricesPerSqm: [50_000, 51_000, 49_500, 50_500],
    });
    expect(result.sufficient).toBe(true);
    if (result.sufficient) {
      expect(result.assessment).toBe("fairly_priced");
    }
  });

  it("classifies a price well below the comparable median as underpriced", () => {
    const result = analyzeAskingPrice({
      askingPrice: 4_000_000, // 40,000/sqm vs ~50,250/sqm median
      targetAreaSqm: 100,
      comparablePricesPerSqm: [50_000, 51_000, 49_500, 50_500],
    });
    expect(result.sufficient).toBe(true);
    if (result.sufficient) {
      expect(result.assessment).toBe("underpriced");
      expect(result.percentageDifference).toBeLessThan(-10);
    }
  });

  it("treats the +/-10% threshold boundary consistently", () => {
    // Exactly at +10% should NOT be classified overpriced (threshold is
    // "> 10%", not ">= 10%").
    const atThreshold = analyzeAskingPrice({
      askingPrice: 1_100_000, // exactly +10% of 1,000,000/sqm * 1sqm
      targetAreaSqm: 1,
      comparablePricesPerSqm: [1_000_000],
    });
    expect(atThreshold.sufficient).toBe(true);
    if (atThreshold.sufficient) {
      expect(atThreshold.assessment).toBe("fairly_priced");
    }
  });
});
