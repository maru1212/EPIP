import {
  prismaPropertyRepository,
  type PropertyRepository,
  type PropertyRecord,
  type CreatePropertyInput,
  type UpdatePropertyDetailsInput,
  type PropertyPublicationStatus,
  type Coordinates,
} from "../repositories/propertyRepository";
import { policyService } from "@/modules/identity/policies";

export class PropertyNotFoundError extends Error {
  constructor() {
    super("Property not found.");
    this.name = "PropertyNotFoundError";
  }
}

/**
 * Distinct from the route-level 403 that `requirePermission` returns for
 * "you don't hold this permission at all" — this is resource-level: the
 * caller DOES hold e.g. `property:update`, but this specific property
 * isn't theirs. Both map to HTTP 403; they're different error types so
 * the two failure modes stay distinguishable in logs/tests.
 */
export class ForbiddenPropertyActionError extends Error {
  constructor() {
    super("You do not have permission to modify this property.");
    this.name = "ForbiddenPropertyActionError";
  }
}

export interface RequestContext {
  userId: string;
}

export interface PropertySearchInput {
  locationNodeId?: string;
  propertyTypeId?: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  minLandAreaSqm?: number;
  maxLandAreaSqm?: number;
  minBuildingAreaSqm?: number;
  maxBuildingAreaSqm?: number;
  near?: { latitude: number; longitude: number; radiusMeters: number };
  limit: number;
  offset: number;
}

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase (authService, policyService, sessionSecurityService),
 * so tests can inject a fake repository and a fake admin-check function
 * and exercise all of this module's business logic with no database
 * involved.
 *
 * `canManageAnyProperty` decides whether a user can act on a property
 * they don't own (the "administrative operations" half of "administrative
 * and owner operations" from the Task 5 spec). There is no dedicated
 * permission for this yet (e.g. a hypothetical `property:manage_any`) —
 * introducing one is a genuine future schema/seed change. As an interim,
 * pragmatic choice, this defaults to checking `user:manage`, a permission
 * only `platform_admin` holds in the current seed data, which has the
 * right *effect* today (only platform_admin bypasses ownership) even
 * though the permission's name is about user accounts, not properties.
 * Flagged explicitly — this is a compromise, not a designed permission.
 */
export function createPropertyService(
  repository: PropertyRepository = prismaPropertyRepository,
  canManageAnyProperty: (userId: string) => Promise<boolean> = (userId) =>
    policyService.can(userId, "user:manage")
) {
  async function assertCanModify(property: PropertyRecord, userId: string): Promise<void> {
    if (property.ownerUserId === null || property.ownerUserId === userId) {
      return;
    }
    if (await canManageAnyProperty(userId)) {
      return;
    }
    throw new ForbiddenPropertyActionError();
  }

  return {
    /**
     * Ownership is always taken from the authenticated caller
     * (`context.userId`), never from client-supplied input — accepting a
     * client-provided owner would let anyone assign a property to someone
     * else. New properties start as `draft` unless the caller specifies
     * otherwise (a freshly created record isn't ready for public search
     * results yet).
     */
    async createProperty(
      input: Omit<CreatePropertyInput, "ownerUserId">,
      context: RequestContext
    ): Promise<PropertyRecord> {
      return repository.create({
        ...input,
        ownerUserId: context.userId,
        publicationStatus: input.publicationStatus ?? "draft",
      });
    },

    /**
     * The public detail lookup: only ever returns a `published` property,
     * regardless of who's asking — this backs the public, unauthenticated
     * GET route. A draft isn't treated as "exists but forbidden" (which
     * would confirm its existence to a stranger); it's treated as not
     * found, the same as a nonexistent ID.
     */
    async getPublishedProperty(id: string): Promise<PropertyRecord | null> {
      const property = await repository.findById(id);
      if (!property || property.publicationStatus !== "published") {
        return null;
      }
      return property;
    },

    /**
     * Public search: always restricted to `published` properties — see
     * getPublishedProperty's reasoning. `near` requires all three of
     * latitude/longitude/radiusMeters together; the route/validation
     * layer is responsible for that being all-or-nothing before this is
     * called.
     */
    async search(input: PropertySearchInput): Promise<PropertyRecord[]> {
      const near = input.near
        ? {
            center: { latitude: input.near.latitude, longitude: input.near.longitude },
            radiusMeters: input.near.radiusMeters,
          }
        : undefined;

      return repository.search({
        locationNodeId: input.locationNodeId,
        propertyTypeId: input.propertyTypeId,
        minBedrooms: input.minBedrooms,
        maxBedrooms: input.maxBedrooms,
        minLandAreaSqm: input.minLandAreaSqm,
        maxLandAreaSqm: input.maxLandAreaSqm,
        minBuildingAreaSqm: input.minBuildingAreaSqm,
        maxBuildingAreaSqm: input.maxBuildingAreaSqm,
        publicationStatus: "published",
        near,
        limit: input.limit,
        offset: input.offset,
      });
    },

    async updateDetails(
      id: string,
      patch: UpdatePropertyDetailsInput,
      context: RequestContext
    ): Promise<PropertyRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new PropertyNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      const updated = await repository.updateDetails(id, patch);
      if (!updated) {
        // Deleted between the findById above and this call — treat as
        // not found rather than returning a stale/partial result.
        throw new PropertyNotFoundError();
      }
      return updated;
    },

    async updateCoordinates(
      id: string,
      coordinates: Coordinates | null,
      context: RequestContext
    ): Promise<PropertyRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new PropertyNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      const updated = await repository.updateCoordinates(id, coordinates);
      if (!updated) {
        throw new PropertyNotFoundError();
      }
      return updated;
    },

    async updatePublicationStatus(
      id: string,
      status: PropertyPublicationStatus,
      context: RequestContext
    ): Promise<PropertyRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new PropertyNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      const updated = await repository.updatePublicationStatus(id, status);
      if (!updated) {
        throw new PropertyNotFoundError();
      }
      return updated;
    },

    /**
     * "Delete," per this project's "prefer soft-deactivation over
     * destructive deletes" principle (established in Task 2): archives
     * rather than issuing a real SQL DELETE. Gated behind `property:delete`
     * at the route level; ownership/admin check happens the same way as
     * every other mutation here.
     */
    async archiveProperty(id: string, context: RequestContext): Promise<PropertyRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new PropertyNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      const updated = await repository.updatePublicationStatus(id, "archived");
      if (!updated) {
        throw new PropertyNotFoundError();
      }
      return updated;
    },
  };
}

export const propertyService = createPropertyService();
