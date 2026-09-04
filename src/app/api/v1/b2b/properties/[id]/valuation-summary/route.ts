import { requirePermission } from "@/lib/withPermission";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { prismaPropertyRepository } from "@/modules/property/repositories/propertyRepository";
import { prismaValuationRepository } from "@/modules/valuation/repositories/valuationRepository";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * B2B/institutional scaffolding endpoint (Task 8) — gated behind
 * `market_data:read`, a genuinely new permission (no dedicated
 * `institutional_client` role exists yet; granted to `market_researcher`/
 * `platform_admin` for now — see docs/search-and-b2b-domain.md).
 *
 * Returns the property's core metadata plus its most recent
 * `ValuationReport`, if one exists — this is a read of already-computed
 * data, not a trigger to generate a fresh valuation on demand (that would
 * be a mutation-like side effect on a GET, and would duplicate
 * POST /api/valuations/estimate). `valuation: null` when no report has
 * ever been generated for this property.
 */
export const GET = requirePermission<[RouteContext]>(
  "market_data:read",
  async (_request, _context, { params }) => {
    const { id } = await params;

    const property = await prismaPropertyRepository.findById(id);
    if (!property) {
      return errorResponse("not_found", "Property not found.", { status: 404 });
    }

    const latestReport = await prismaValuationRepository.findLatestByPropertyId(id);

    return successResponse({
      property: {
        id: property.id,
        locationNodeId: property.locationNodeId,
        propertyTypeId: property.propertyTypeId,
        coordinates: property.coordinates,
        buildingAreaSqm: property.buildingAreaSqm,
        landAreaSqm: property.landAreaSqm,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        condition: property.condition,
        verificationStatus: property.verificationStatus,
      },
      valuation: latestReport
        ? {
            id: latestReport.id,
            estimatedValue: latestReport.estimatedValue,
            lowEstimate: latestReport.lowEstimate,
            highEstimate: latestReport.highEstimate,
            confidenceScore: latestReport.confidenceScore,
            methodology: latestReport.methodology,
            createdAt: latestReport.createdAt,
          }
        : null,
    });
  }
);
