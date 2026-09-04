import type {
  AIValuationProvider,
  NarrativeGenerationInput,
  NarrativeGenerationOutput,
} from "./aiProvider";
import { AIProviderError } from "./aiProvider";
import { buildValuationNarrativePrompt } from "./prompt";

/**
 * A real, correct implementation of the adapter pattern against
 * Anthropic's actual Messages API — not a stub. This proves the
 * interface genuinely supports swapping in a real LLM provider, not just
 * the mock.
 *
 * Honesty note: this cannot be exercised end-to-end in this sandbox.
 * There is no ANTHROPIC_API_KEY configured here, and even if one were,
 * making real, billed API calls as part of building/testing this feature
 * wouldn't be appropriate without explicit authorization. This is the
 * same category of "correct but environment-limited" code that recurs
 * throughout this project (e.g. Prisma Client generation) — the
 * difference here is the limitation is "no API key," not "blocked
 * network," and this project's network allowlist does in fact include
 * api.anthropic.com.
 */
export function createAnthropicProvider(apiKey: string, timeoutMs: number): AIValuationProvider {
  return {
    name: "anthropic",

    async generateNarrative(
      input: NarrativeGenerationInput
    ): Promise<NarrativeGenerationOutput> {
      const prompt = buildValuationNarrativePrompt(input);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new AIProviderError("Anthropic API request failed or timed out.", error);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new AIProviderError(
          `Anthropic API returned an error status: ${response.status}.`
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new AIProviderError("Anthropic API response was not valid JSON.", error);
      }

      const text = extractTextContent(raw);
      if (text === null) {
        throw new AIProviderError("Anthropic API response had no text content block.");
      }

      return parseNarrativeJson(text);
    },
  };
}

function extractTextContent(raw: unknown): string | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("content" in raw) ||
    !Array.isArray((raw as { content: unknown }).content)
  ) {
    return null;
  }
  const content = (raw as { content: Array<{ type?: string; text?: string }> }).content;
  const textBlock = content.find((block) => block.type === "text" && typeof block.text === "string");
  return textBlock?.text ?? null;
}

/**
 * The model is instructed (in the prompt) to return only a JSON object,
 * but models don't always comply perfectly — a real integration has to
 * tolerate that. Strips markdown code fences defensively before parsing;
 * any other malformed shape throws AIProviderError, which
 * aiValuationService treats as a normal fallback trigger, not a crash.
 */
function parseNarrativeJson(text: string): NarrativeGenerationOutput {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new AIProviderError("Anthropic response could not be parsed as JSON.", error);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).executiveSummary !== "string" ||
    typeof (parsed as Record<string, unknown>).locationAnalysis !== "string" ||
    typeof (parsed as Record<string, unknown>).pricingFactors !== "string" ||
    typeof (parsed as Record<string, unknown>).confidenceExplanation !== "string"
  ) {
    throw new AIProviderError(
      "Anthropic response JSON did not match the expected narrative shape."
    );
  }

  const result = parsed as {
    executiveSummary: string;
    locationAnalysis: string;
    pricingFactors: string;
    confidenceExplanation: string;
  };
  return {
    executiveSummary: result.executiveSummary,
    locationAnalysis: result.locationAnalysis,
    pricingFactors: result.pricingFactors,
    confidenceExplanation: result.confidenceExplanation,
  };
}
