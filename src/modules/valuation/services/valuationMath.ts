/**
 * Pure functions — no database, no I/O — deliberately separated from
 * valuationService.ts so the actual math can be unit tested directly
 * with plain numbers, same pattern as listingService.ts's
 * calculatePricePerSqm.
 *
 * This is an explicitly simple, v0 statistical heuristic, not a
 * calibrated valuation model — consistent with this project's repeated
 * "architecture before algorithm" principle (Task 2's data-quality
 * fields, Task 6's price-per-sqm): the goal here is a defensible,
 * documented, testable starting point that real market data can later
 * be used to calibrate, not a production-grade AVM. See
 * docs/valuation-domain.md for the full reasoning.
 */

export type PropertyConditionKey =
  | "new"
  | "excellent"
  | "good"
  | "needs_renovation"
  | "under_construction";

/**
 * A simple, explicit multiplier table relative to "good" condition as the
 * neutral baseline (1.0) — not derived from any real calibration data,
 * since none exists yet. Revisit once there's enough real transaction
 * data to fit this properly.
 */
const CONDITION_MULTIPLIERS: Record<PropertyConditionKey, number> = {
  new: 1.1,
  excellent: 1.05,
  good: 1.0,
  needs_renovation: 0.85,
  under_construction: 0.9,
};
const DEFAULT_CONDITION_MULTIPLIER = 1.0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function conditionMultiplier(condition: string | null): number {
  if (condition && condition in CONDITION_MULTIPLIERS) {
    return CONDITION_MULTIPLIERS[condition as PropertyConditionKey];
  }
  return DEFAULT_CONDITION_MULTIPLIER;
}

export interface ValuationEstimateResult {
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  /** 0.00-1.00. */
  confidenceScore: number;
  medianPricePerSqm: number;
  averagePricePerSqm: number;
  comparableCount: number;
  /** null when fewer than 2 comparables (variance isn't meaningful with 1). */
  coefficientOfVariation: number | null;
  conditionMultiplierApplied: number;
}

export type InsufficientComparableDataResult = {
  sufficient: false;
  comparableCount: 0;
};

export type ComputeValuationOutcome =
  | ({ sufficient: true } & ValuationEstimateResult)
  | InsufficientComparableDataResult;

/**
 * The core estimation algorithm. Deliberately does NOT fabricate a number
 * when there are zero comparables — see docs/valuation-domain.md §1 for
 * why "return a baseline fallback with low confidence" was interpreted as
 * "return confidence 0 and no invented price" rather than a hardcoded
 * placeholder value with no real market basis. Callers (valuationService)
 * are responsible for NOT persisting a ValuationReport in the
 * `sufficient: false` case.
 */
export function computeValuationEstimate(params: {
  comparablePricesPerSqm: number[];
  targetAreaSqm: number;
  condition: string | null;
}): ComputeValuationOutcome {
  const n = params.comparablePricesPerSqm.length;
  if (n === 0) {
    return { sufficient: false, comparableCount: 0 };
  }

  const med = median(params.comparablePricesPerSqm);
  const avg = mean(params.comparablePricesPerSqm);
  const sd = sampleStdDev(params.comparablePricesPerSqm, avg);
  const coefficientOfVariation = n >= 2 && avg > 0 ? sd / avg : null;

  const multiplier = conditionMultiplier(params.condition);
  const midEstimate = med * params.targetAreaSqm * multiplier;

  // A single comparable can't have its variance measured — treated as a
  // fixed, deliberately pessimistic consistency score rather than the
  // misleadingly perfect "zero variance" a literal stddev(1 value) gives.
  const consistencyScore =
    n === 1 ? 0.2 : clamp(1 - clamp(coefficientOfVariation ?? 0, 0, 1), 0, 1);
  const sampleSizeScore = clamp(n / 8, 0, 1); // saturates at 8+ comparables
  const confidenceScore = round2(clamp(0.5 * sampleSizeScore + 0.5 * consistencyScore, 0, 1));

  // Wider low/high spread for smaller samples and higher variance —
  // opposite drivers of the same underlying "how sure are we" question
  // confidenceScore answers, expressed as a price range instead of a
  // single number.
  const varianceSpread = n === 1 ? 0.25 : clamp(coefficientOfVariation ?? 0, 0.05, 0.5);
  const smallSampleCaution = n < 3 ? 0.15 : 0;
  const spread = clamp(varianceSpread + smallSampleCaution, 0.05, 0.6);

  return {
    sufficient: true,
    estimatedValue: round2(midEstimate),
    lowEstimate: round2(midEstimate * (1 - spread)),
    highEstimate: round2(midEstimate * (1 + spread)),
    confidenceScore,
    medianPricePerSqm: round2(med),
    averagePricePerSqm: round2(avg),
    comparableCount: n,
    coefficientOfVariation: coefficientOfVariation !== null ? round4(coefficientOfVariation) : null,
    conditionMultiplierApplied: multiplier,
  };
}

export type PriceAssessment = "overpriced" | "fairly_priced" | "underpriced";

/**
 * +/-10% is a simple, explicit, documented threshold — not derived from
 * calibration data, same caveat as the condition multipliers above.
 */
const OVERPRICED_THRESHOLD_PERCENT = 10;
const UNDERPRICED_THRESHOLD_PERCENT = -10;

export interface PriceAnalysisResult {
  assessment: PriceAssessment;
  /** Positive: asking price is above the comparable median. Negative: below. */
  percentageDifference: number;
  askingPricePerSqm: number;
  medianComparablePricePerSqm: number;
  comparableCount: number;
}

export type InsufficientAnalysisDataResult = {
  sufficient: false;
  comparableCount: 0;
};

export type AnalyzeAskingPriceOutcome =
  | ({ sufficient: true } & PriceAnalysisResult)
  | InsufficientAnalysisDataResult;

/**
 * The "is this overpriced?" analyzer. Same "no data, no verdict" principle
 * as computeValuationEstimate — with zero comparables there is nothing to
 * compare the asking price against, so this returns `sufficient: false`
 * rather than guessing.
 */
export function analyzeAskingPrice(params: {
  askingPrice: number;
  targetAreaSqm: number;
  comparablePricesPerSqm: number[];
}): AnalyzeAskingPriceOutcome {
  const n = params.comparablePricesPerSqm.length;
  if (n === 0) {
    return { sufficient: false, comparableCount: 0 };
  }

  const med = median(params.comparablePricesPerSqm);
  const askingPricePerSqm = params.askingPrice / params.targetAreaSqm;
  const percentageDifference =
    med > 0 ? ((askingPricePerSqm - med) / med) * 100 : 0;

  let assessment: PriceAssessment;
  if (percentageDifference > OVERPRICED_THRESHOLD_PERCENT) {
    assessment = "overpriced";
  } else if (percentageDifference < UNDERPRICED_THRESHOLD_PERCENT) {
    assessment = "underpriced";
  } else {
    assessment = "fairly_priced";
  }

  return {
    sufficient: true,
    assessment,
    percentageDifference: round2(percentageDifference),
    askingPricePerSqm: round2(askingPricePerSqm),
    medianComparablePricePerSqm: round2(med),
    comparableCount: n,
  };
}
