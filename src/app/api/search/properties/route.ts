import { searchDiscoverySchema } from "@/lib/validation/search";
import { searchService } from "@/modules/search/services/searchService";
import { successResponse, errorResponse } from "@/lib/apiResponse";

/**
 * Public, no permission gate — same reasoning as GET /api/properties and
 * GET /api/listings (the original permission matrix makes browsing
 * public). Not rate-limited, consistent with that same existing
 * precedent; unlike POST /api/analytics/evaluate-listing (which does
 * real per-request computation and is explicitly asked to be rate-limited
 * against scraping), this is a straightforward read query. Uses the new
 * standardized `{ success, data, meta }` envelope — see
 * docs/search-and-b2b-domain.md for why this isn't retrofitted onto
 * Tasks 5-7's existing routes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());

  const parsed = searchDiscoverySchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse(
      "validation_error",
      "One or more query parameters are invalid.",
      { status: 400, details: parsed.error.flatten().fieldErrors }
    );
  }

  const {
    propertyType,
    minBuildingSize,
    latitude,
    longitude,
    radiusMeters,
    limit,
    offset,
    ...rest
  } = parsed.data;

  const nearFieldsProvided = [latitude, longitude, radiusMeters].filter(
    (v) => v !== undefined
  ).length;
  if (nearFieldsProvided > 0 && nearFieldsProvided < 3) {
    return errorResponse(
      "validation_error",
      "latitude, longitude, and radiusMeters must be provided together.",
      { status: 400 }
    );
  }

  const results = await searchService.searchProperties({
    ...rest,
    propertyTypeId: propertyType,
    minBuildingAreaSqm: minBuildingSize,
    near:
      latitude !== undefined && longitude !== undefined && radiusMeters !== undefined
        ? { latitude, longitude, radiusMeters }
        : undefined,
    limit,
    offset,
  });

  return successResponse(results, {
    meta: { pagination: { limit, offset, count: results.length } },
  });
}
