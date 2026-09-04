import { requirePermission } from "@/lib/withPermission";
import { createListingSchema, searchListingSchema } from "@/lib/validation/listing";
import {
  listingService,
  PropertyNotFoundForListingError,
} from "@/modules/listing/services/listingService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

/**
 * Public: no permission gate, same reasoning as GET /api/properties.
 * Always restricted to `active` listings on `published` properties
 * (see listingService.search) regardless of who's asking.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());

  const parsed = searchListingSchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse(
      "validation_error",
      "One or more query parameters are invalid.",
      { status: 400, details: parsed.error.flatten().fieldErrors }
    );
  }

  const { latitude, longitude, radiusMeters, limit, offset, ...rest } = parsed.data;

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

  try {
    const listings = await listingService.search({
      ...rest,
      limit,
      offset,
      near:
        latitude !== undefined && longitude !== undefined && radiusMeters !== undefined
          ? { latitude, longitude, radiusMeters }
          : undefined,
    });

    return successResponse(listings, {
      meta: { pagination: { limit, offset, count: listings.length } },
    });
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/listings");
  }
}

export const POST = requirePermission("listing:create", async (request, { userId }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.", {
      status: 400,
    });
  }

  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", "One or more fields are invalid.", {
      status: 400,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const listing = await listingService.createListing(parsed.data, { userId });
    return successResponse(listing, { status: 201 });
  } catch (error) {
    if (error instanceof PropertyNotFoundForListingError) {
      return errorResponse("property_not_found", error.message, { status: 404 });
    }
    return handleUnexpectedError(error, "POST /api/listings");
  }
});
