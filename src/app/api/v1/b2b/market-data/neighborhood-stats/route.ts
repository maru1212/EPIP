import { requirePermission } from "@/lib/withPermission";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { neighborhoodStatsSchema } from "@/lib/validation/search";
import { marketDataService } from "@/modules/search/services/marketDataService";

/**
 * B2B/institutional scaffolding endpoint (Task 8) — gated behind
 * `market_data:read`, same as the valuation-summary endpoint. Aggregates
 * over the given LocationNode AND all of its descendants (e.g. querying
 * the "Bole" subcity includes every neighborhood beneath it) — verified
 * against a real three-level hierarchy (subcity -> two neighborhoods)
 * with properties at every level.
 */
export const GET = requirePermission("market_data:read", async (request) => {
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());

  const parsed = neighborhoodStatsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse(
      "validation_error",
      "locationNodeId (a valid UUID) is required.",
      { status: 400, details: parsed.error.flatten().fieldErrors }
    );
  }

  const stats = await marketDataService.getNeighborhoodStats(parsed.data.locationNodeId);
  if (!stats) {
    return errorResponse("not_found", "Location node not found.", { status: 404 });
  }

  return successResponse(stats);
});
