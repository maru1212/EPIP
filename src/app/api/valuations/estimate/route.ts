import { auth } from "@/lib/auth";
import { getClientIp } from "@/lib/getClientIp";
import { estimateValuationSchema } from "@/lib/validation/valuation";
import {
  valuationService,
  PropertyNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationRateLimitExceededError,
} from "@/modules/valuation/services/valuationService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

/**
 * Public and rate-limited, not permission-gated — per the Task 7 spec's
 * explicit "public freemium access" framing and `ValuationReport.
 * requestedByUserId` being optional. `auth()` is called directly here
 * (not through `requirePermission`) purely for OPTIONAL attribution: if a
 * session happens to exist, the report records who asked for it; if not,
 * the request still proceeds as an anonymous, rate-limited estimate. This
 * is a deliberately different use of `auth()` than authorization
 * enforcement (which always goes through `requirePermission` — see
 * lib/withPermission.ts) — there is no gate/deny decision here, only
 * optional identification. See docs/valuation-domain.md §2.
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

  const parsed = estimateValuationSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", "One or more fields are invalid.", {
      status: 400,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const session = await auth();
  const ip = getClientIp(request);

  try {
    const outcome = await valuationService.estimateValue(parsed.data.propertyId, {
      userId: session?.user?.id,
      ip,
    });

    if (!outcome.persisted) {
      return successResponse({
        persisted: false,
        message:
          "Not enough comparable market data was found near this property to produce a reliable estimate.",
        comparableCount: 0,
      });
    }

    return successResponse(
      { persisted: true, report: outcome.report, comparableCount: outcome.comparableCount },
      { status: 201 }
    );
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
    return handleUnexpectedError(error, "POST /api/valuations/estimate");
  }
}
