import { requirePermission } from "@/lib/withPermission";
import { aiValuationService } from "@/modules/valuation/services/aiValuationService";
import {
  ValuationReportNotFoundError,
  ForbiddenValuationActionError,
} from "@/modules/valuation/services/valuationService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Gated behind `valuation:view`, same as GET /api/valuations/[id] — a
 * report's AI narrative is exactly as sensitive as the report itself.
 * Ownership is enforced by the underlying `valuationService.getReport`
 * call (reused, not duplicated — see aiValuationService.getAiSummary).
 *
 * Never triggers a new AI call — this only reads whatever narrative (if
 * any) was already persisted. A report that exists but was never
 * AI-enriched (or whose enrichment failed and fell back) returns 200
 * with `aiEnriched: false`, not a 404 — the underlying report is real;
 * it simply has no AI narrative yet. 404 is reserved for the report
 * itself not existing at all.
 */
export const GET = requirePermission<[RouteContext]>(
  "valuation:view",
  async (_request, { userId }, { params }) => {
    const { id } = await params;

    try {
      const summary = await aiValuationService.getAiSummary(id, { userId });
      return successResponse(summary);
    } catch (error) {
      if (error instanceof ValuationReportNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenValuationActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "GET /api/valuations/[id]/ai-summary");
    }
  }
);
