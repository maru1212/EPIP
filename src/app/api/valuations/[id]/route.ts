import { requirePermission } from "@/lib/withPermission";
import {
  valuationService,
  ValuationReportNotFoundError,
  ForbiddenValuationActionError,
} from "@/modules/valuation/services/valuationService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Unlike Property/Listing's public GETs, this one is gated behind
 * `valuation:view` — a saved report is closer to a personal query result
 * than a public marketplace listing, and the Task 7 spec explicitly asks
 * for this endpoint to be permission-protected. See
 * docs/valuation-domain.md §2. Ownership (the report's requester, or an
 * admin override) is additionally enforced in valuationService.getReport.
 */
export const GET = requirePermission<[RouteContext]>(
  "valuation:view",
  async (_request, { userId }, { params }) => {
    const { id } = await params;

    try {
      const report = await valuationService.getReport(id, { userId });
      return successResponse(report);
    } catch (error) {
      if (error instanceof ValuationReportNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenValuationActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "GET /api/valuations/[id]");
    }
  }
);
