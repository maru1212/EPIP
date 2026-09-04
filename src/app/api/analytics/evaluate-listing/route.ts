import { getClientIp } from "@/lib/getClientIp";
import { evaluateListingSchema } from "@/lib/validation/analytics";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import {
  valuationService,
  PropertyNotFoundForValuationError,
  ListingNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationRateLimitExceededError,
} from "@/modules/valuation/services/valuationService";

/**
 * Public, strictly rate-limited (per Task 8's explicit "protect against
 * automated scraping" requirement) — reuses the same Postgres-backed
 * limiter and per-IP config as Task 7's analyze-listing endpoint (this is
 * a rebrand/superset of that same capability, with two additional input
 * modes). No permission gate, same reasoning as every other public
 * discovery/analysis endpoint in this project. Uses the new standardized
 * envelope — see docs/search-and-b2b-domain.md.
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

  const parsed = evaluateListingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "validation_error",
      "One or more fields are invalid.",
      { status: 400, details: parsed.error.flatten().fieldErrors }
    );
  }

  const ip = getClientIp(request);
  const input = parsed.data;

  try {
    const outcome = input.propertyId
      ? await valuationService.analyzeListingPrice(input.propertyId, input.askingPrice!, {
          ip,
        })
      : input.listingId
        ? await valuationService.analyzeListingById(input.listingId, { ip })
        : await valuationService.analyzeAdHoc(
            {
              latitude: input.latitude!,
              longitude: input.longitude!,
              buildingAreaSqm: input.buildingSize!,
              propertyTypeId: input.propertyTypeId!,
              askingPrice: input.askingPrice!,
            },
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
    if (error instanceof ListingNotFoundForValuationError) {
      return errorResponse("listing_not_found", error.message, { status: 404 });
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
    throw error;
  }
}
