import { successResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";
import { locationService } from "@/modules/location/services/locationService";

/**
 * Task 11: a small, necessary addition — the Property Search UI's
 * location dropdowns and the Overpriced Evaluator Widget's location
 * selector both need real LocationNode ids to send to the search/
 * evaluate APIs, and no endpoint previously existed to list them. Public
 * reference data, same reasoning as /api/property-types: read-only,
 * no permission gate, no rate limiting.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const level = url.searchParams.get("level") ?? undefined;

  try {
    const locations = await locationService.listLocations(level);
    return successResponse(locations);
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/locations");
  }
}
