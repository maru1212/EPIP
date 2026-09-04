import { requirePermission } from "@/lib/withPermission";
import { createPropertySchema, searchPropertySchema } from "@/lib/validation/property";
import { propertyService } from "@/modules/property/services/propertyService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

/**
 * Public: no permission gate. Per the original permission matrix, viewing
 * properties is intended to be available to unauthenticated visitors
 * (Guest) as well as every authenticated role — gating this behind
 * `requirePermission` would mean unauthenticated visitors get 401 just
 * for browsing, which contradicts that. Always restricted to `published`
 * properties (see propertyService.search) regardless of who's asking —
 * there is no session here to distinguish an owner from a stranger.
 *
 * Task 9: retrofitted to the standardized `{ success, data, meta }` /
 * `{ success, error }` envelope (src/lib/apiResponse.ts) and the shared
 * error boundary (src/lib/errorBoundary.ts) — see
 * docs/api-standardization.md.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());

  const parsed = searchPropertySchema.safeParse(rawParams);
  if (!parsed.success) {
    return errorResponse(
      "validation_error",
      "One or more query parameters are invalid.",
      { status: 400, details: parsed.error.flatten().fieldErrors }
    );
  }

  const { latitude, longitude, radiusMeters, limit, offset, ...rest } = parsed.data;

  // "near" search requires all three of lat/lon/radius together — a
  // partial combination is a validation error, not silently ignored.
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
    const properties = await propertyService.search({
      ...rest,
      limit,
      offset,
      near:
        latitude !== undefined && longitude !== undefined && radiusMeters !== undefined
          ? { latitude, longitude, radiusMeters }
          : undefined,
    });

    return successResponse(properties, {
      meta: { pagination: { limit, offset, count: properties.length } },
    });
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/properties");
  }
}

export const POST = requirePermission("property:create", async (request, { userId }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.", {
      status: 400,
    });
  }

  const parsed = createPropertySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("validation_error", "One or more fields are invalid.", {
      status: 400,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const property = await propertyService.createProperty(parsed.data, { userId });
    return successResponse(property, { status: 201 });
  } catch (error) {
    return handleUnexpectedError(error, "POST /api/properties");
  }
});
