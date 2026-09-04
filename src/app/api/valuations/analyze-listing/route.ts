import { getClientIp } from "@/lib/getClientIp";
import { analyzeListingPriceSchema } from "@/lib/validation/valuation";
import {
  valuationService,
  PropertyNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationRateLimitExceededError,
} from "@/modules/valuation/services/valuationService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

/**
 * Public and rate-limited, same reasoning as
 * POST /api/valuations/estimate. Stateless — no ValuationReport is
 * created here (see docs/valuation-domain.md §3), so there's no
 * "requested by" attribution to bother capturing; the session isn't
 * consulted at all.
 *
 * Task 9: retrofitted to the standardized envelope even though not
 * explicitly bulleted under item 1's route list — "all existing
 * endpoints from Tasks 5, 6, and 7" implies this one too, and leaving it
 * inconsistent with its sibling /api/valuations/estimate would be a
 * strange half-measure.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.", {
      status: 400,
    });
  }

  const parsed = analyzeListingPriceSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", "One or more fields are invalid.", {
      status: 400,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const ip = getClientIp(request);

  try {
    const outcome = await valuationService.analyzeListingPrice(
      parsed.data.propertyId,
      parsed.data.askingPrice,
      { ip }
    );

    if (!outcome.sufficient) {
      return successResponse({
        sufficient: false,
        message:
          "Not enough comparable market data was found near this property to assess the asking price.",
        comparableCount: 0,
      });
    }

    return successResponse(outcome);
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
    return handleUnexpectedError(error, "POST /api/valuations/analyze-listing");
  }
}
