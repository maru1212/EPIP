import type { AIValuationProvider } from "./aiProvider";
import { mockAIProvider } from "./mockAIProvider";
import { createAnthropicProvider } from "./anthropicAIProvider";
import { env } from "@/lib/env";

/**
 * Defaults to the mock provider whenever `anthropic` is requested but no
 * API key is configured — this system must always work with zero AI
 * setup, per the Task 10 spec's explicit requirement, rather than
 * failing at startup or on every request. A misconfiguration here fails
 * soft (falls back to mock), not hard.
 */
export function createAIProvider(): AIValuationProvider {
  if (env.ai.provider === "anthropic" && env.ai.anthropicApiKey) {
    return createAnthropicProvider(env.ai.anthropicApiKey, env.ai.timeoutMs);
  }
  return mockAIProvider;
}
