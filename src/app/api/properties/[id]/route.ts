import { requirePermission } from "@/lib/withPermission";
import { updatePropertyDetailsSchema } from "@/lib/validation/property";
import {
  propertyService,
  PropertyNotFoundError,
  ForbiddenPropertyActionError,
} from "@/modules/property/services/propertyService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Public: no permission gate, same reasoning as GET /api/properties.
 * Only ever returns a `published` property (propertyService.
 * getPublishedProperty) — a draft or archived property looks identical
 * to a nonexistent one from this endpoint's perspective.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const property = await propertyService.getPublishedProperty(id);

    if (!property) {
      return errorResponse("not_found", "Property not found.", { status: 404 });
    }

    return successResponse(property);
  } catch (error) {
    return handleUnexpectedError(error, "GET /api/properties/[id]");
  }
}

export const PATCH = requirePermission<[RouteContext]>(
  "property:update",
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

    const parsed = updatePropertyDetailsSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", "One or more fields are invalid.", {
        status: 400,
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const property = await propertyService.updateDetails(id, parsed.data, { userId });
      return successResponse(property);
    } catch (error) {
      if (error instanceof PropertyNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenPropertyActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "PATCH /api/properties/[id]");
    }
  }
);

export const DELETE = requirePermission<[RouteContext]>(
  "property:delete",
  async (_request, { userId }, { params }) => {
    const { id } = await params;

    try {
      const property = await propertyService.archiveProperty(id, { userId });
      return successResponse(property);
    } catch (error) {
      if (error instanceof PropertyNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenPropertyActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "DELETE /api/properties/[id]");
    }
  }
);
