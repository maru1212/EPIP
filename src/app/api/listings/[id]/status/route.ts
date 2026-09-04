import { requirePermission } from "@/lib/withPermission";
import { updateListingStatusSchema } from "@/lib/validation/listing";
import {
  listingService,
  ListingNotFoundError,
  ForbiddenListingActionError,
  InvalidStatusTransitionError,
} from "@/modules/listing/services/listingService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Separate from PATCH /api/listings/[id] (price/currency/contactInfo
 * edits): a status transition (draft -> active -> sold/rented/expired/
 * archived) is validated against an explicit state machine
 * (listingService's ALLOWED_STATUS_TRANSITIONS), not a free-form field
 * update. Gated behind `listing:update` — a status change is still
 * "updating" the record; `listing:delete` is reserved for the
 * archive-via-DELETE path (see `[id]/route.ts`).
 */
export const PATCH = requirePermission<[RouteContext]>(
  "listing:update",
  async (request, { userId }, { params }) => {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid_json", "Request body must be valid JSON.", {
        status: 400,
      });
    }

    const parsed = updateListingStatusSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        "status must be one of: draft, active, sold, rented, expired, archived.",
        { status: 400, details: parsed.error.flatten().fieldErrors }
      );
    }

    try {
      const listing = await listingService.updateStatus(id, parsed.data.status, {
        userId,
      });
      return successResponse(listing);
    } catch (error) {
      if (error instanceof ListingNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenListingActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      if (error instanceof InvalidStatusTransitionError) {
        return errorResponse("invalid_transition", error.message, { status: 409 });
      }
      return handleUnexpectedError(error, "PATCH /api/listings/[id]/status");
    }
  }
);
