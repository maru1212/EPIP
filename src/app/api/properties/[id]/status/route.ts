import { requirePermission } from "@/lib/withPermission";
import { updatePublicationStatusSchema } from "@/lib/validation/property";
import {
  propertyService,
  PropertyNotFoundError,
  ForbiddenPropertyActionError,
} from "@/modules/property/services/propertyService";
import { successResponse, errorResponse } from "@/lib/apiResponse";
import { handleUnexpectedError } from "@/lib/errorBoundary";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Separate from PATCH /api/properties/[id] (general detail edits): a
 * publication-status transition (draft -> published -> archived) is a
 * distinct kind of action from editing bedrooms/area/etc, worth its own
 * endpoint. Gated behind `property:update` — the same permission as
 * detail edits, since a status change is still "updating" the record;
 * `property:delete` is reserved for the archive-via-DELETE path (see
 * `[id]/route.ts`).
 */
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

    const parsed = updatePublicationStatusSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        "publicationStatus must be one of: draft, published, archived.",
        { status: 400, details: parsed.error.flatten().fieldErrors }
      );
    }

    try {
      const property = await propertyService.updatePublicationStatus(
        id,
        parsed.data.publicationStatus,
        { userId }
      );
      return successResponse(property);
    } catch (error) {
      if (error instanceof PropertyNotFoundError) {
        return errorResponse("not_found", error.message, { status: 404 });
      }
      if (error instanceof ForbiddenPropertyActionError) {
        return errorResponse("forbidden", error.message, { status: 403 });
      }
      return handleUnexpectedError(error, "PATCH /api/properties/[id]/status");
    }
  }
);
