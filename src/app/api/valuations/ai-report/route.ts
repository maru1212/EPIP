import { requirePermission } from "@/lib/withPermission";
import { getClientIp } from "@/lib/getClientIp";
import { aiReportRequestSchema } from "@/lib/validation/valuation";
import { aiValuationService } from "@/modules/valuation/services/aiValuationService";
import {
  PropertyNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationRateLimitExceededError,
} from "@/modules/valuation/services/valuationService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

/**
 * Gated behind `valuation:create` — a genuinely new permission (Task 10),
 * distinct from the deliberately-public statistical
 * `/api/valuations/estimate`: generating the AI-enriched narrative is a
 * heavier, costlier operation, so it's treated as an elevated capability
 * rather than freemium. See docs/ai-valuation-domain.md.
 *
 * Never returns 500 for an AI-layer failure — `aiValuationService.
 * generateAiReport` already falls back to the plain statistical report
 * with `aiEnriched: false` on any provider error/timeout/malformed
 * response. Errors from the underlying STATISTICAL step (property not
 * found, no usable area, rate limited) are real error conditions and are
 * still mapped to their proper status codes below, same as
 * `/api/valuations/estimate`.
 */
export const POST = requirePermission("valuation:create", async (request, { userId }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.", {
      status: 400,
    });
  }

  const parsed = aiReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", "One or more fields are invalid.", {
      status: 400,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const ip = getClientIp(request);

  try {
    const outcome = await aiValuationService.generateAiReport(parsed.data.propertyId, {
      userId,
      ip,
    });

    if (!outcome.persisted) {
      return successResponse({
        persisted: false,
        aiEnriched: false,
        message:
          "Not enough comparable market data was found near this property to produce a reliable estimate.",
        comparableCount: 0,
      });
    }

    return successResponse(outcome, { status: outcome.aiEnriched ? 201 : 200 });
  } catch (error) {
    if (error instanceof PropertyNotFoundForValuationError) {
      return errorResponse("property_not_found", error.message, { status: 404 });
    }
    if (error instanceof PropertyHasNoUsableAreaError) {
      return errorResponse("no_usable_area", error.message, { status: 422 });
    }
    if (error instanceof ValuationRateLimitExceededError) {
      return errorResponse("rate_limited", error.message, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      });
    }
    return handleUnexpectedError(error, "POST /api/valuations/ai-report");
  }
});
