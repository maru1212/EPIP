import { requirePermission } from "@/lib/withPermission";
import { updateListingDetailsSchema } from "@/lib/validation/listing";
import {
  listingService,
  ListingNotFoundError,
  ForbiddenListingActionError,
} from "@/modules/listing/services/listingService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Public: no permission gate, same reasoning as GET /api/properties/[id].
 * Only ever returns an `active` listing on a `published` property
 * (listingService.getPublicListing) — anything else looks like a 404,
 * not a 403, to avoid confirming its existence to a stranger. Includes
 * pricePerSqm in the response (Task 6 item 3's price-intelligence
 * helper) rather than a separate endpoint — it's cheap to compute and
 * directly relevant to viewing a listing's detail.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const listing = await listingService.getPublicListing(id);

    if (!listing) {
      return errorResponse("not_found", "Listing not found.", { status: 404 });
    }

    const pricePerSqm = await listingService.getPricePerSqm(id);
    return successResponse({ listing, pricePerSqm });
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/listings/[id]");
  }
}

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

    const parsed = updateListingDetailsSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", "One or more fields are invalid.", {
        status: 400,
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const listing = await listingService.updateDetails(id, parsed.data, { userId });
      return successResponse(listing);
    } catch (error) {
      if (error instanceof ListingNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenListingActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "PATCH /api/listings/[id]");
    }
  }
);

export const DELETE = requirePermission<[RouteContext]>(
  "listing:delete",
  async (_request, { userId }, { params }) => {
    const { id } = await params;

    try {
      const listing = await listingService.archiveListing(id, { userId });
      return successResponse(listing);
    } catch (error) {
      if (error instanceof ListingNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenListingActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "DELETE /api/listings/[id]");
    }
  }
);
