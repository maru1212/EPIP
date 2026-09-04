/**
 * The adapter interface every AI provider (mock, Anthropic, a future
 * OpenAI provider, etc.) implements. `aiValuationService.ts` depends only
 * on this interface, never on a specific provider — the same DI pattern
 * used throughout this codebase (repositories behind service interfaces,
 * rate limiters behind `RateLimiter`).
 */

export interface NarrativeGenerationInput {
  propertyId: string;
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceScore: number;
  medianComparablePricePerSqm: number | null;
  comparableCount: number;
  coefficientOfVariation: number | null;
  /** e.g. "apartment", "house", "villa", "land" — the property_types.key. */
  propertyTypeKey: string;
  /** Human-readable location chain, most specific first, e.g. ["Bole", "Addis Ababa"]. */
  locationChain: string[];
  bedrooms: number | null;
  buildingAreaSqm: number | null;
  landAreaSqm: number | null;
  condition: string | null;
  currency: string;
}

export interface NarrativeGenerationOutput {
  executiveSummary: string;
  locationAnalysis: string;
  pricingFactors: string;
  confidenceExplanation: string;
}

/**
 * Thrown by a provider implementation for any failure mode — a network
 * error, a timeout, an API error response, or a response that couldn't
 * be parsed into the expected shape. `aiValuationService` catches this
 * (and anything else unexpected) and falls back to the pure statistical
 * result — per the Task 10 spec, an AI failure must never surface as a
 * 500 to the client.
 */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export interface AIValuationProvider {
  /** A short, stable identifier for logging/persistence (e.g. "mock", "anthropic"). */
  readonly name: string;
  generateNarrative(input: NarrativeGenerationInput): Promise<NarrativeGenerationOutput>;
}
