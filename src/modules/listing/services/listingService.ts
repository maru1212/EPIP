import {
  prismaListingRepository,
  type ListingRepository,
  type ListingRecord,
  type ListingType,
  type ListingStatus,
  type UpdateListingDetailsInput,
} from "../repositories/listingRepository";
import {
  prismaPropertyRepository,
  type PropertyRepository,
} from "@/modules/property/repositories/propertyRepository";
import { policyService } from "@/modules/identity/policies";

export class ListingNotFoundError extends Error {
  constructor() {
    super("Listing not found.");
    this.name = "ListingNotFoundError";
  }
}

export class PropertyNotFoundForListingError extends Error {
  constructor() {
    super("The property this listing would be created for does not exist.");
    this.name = "PropertyNotFoundForListingError";
  }
}

/**
 * Distinct from the route-level 403 `requirePermission` returns for "you
 * don't hold this permission at all" — this is resource-level, same
 * pattern as propertyService's ForbiddenPropertyActionError.
 */
export class ForbiddenListingActionError extends Error {
  constructor() {
    super("You do not have permission to modify this listing.");
    this.name = "ForbiddenListingActionError";
  }
}

/**
 * A deliberately small, fixed state machine — not every ListingStatus
 * transition makes sense from every other status (e.g. you shouldn't be
 * able to move a `sold` listing back to `active`, and `draft` should only
 * ever move forward to `active`, not sideways to `sold`/`rented`).
 * Encoded explicitly here rather than left as "any status to any status,"
 * which would let a client accidentally corrupt a listing's history.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ["active", "archived"],
  active: ["sold", "rented", "expired", "archived"],
  sold: ["archived"],
  rented: ["archived", "active"], // a rental can become available again
  expired: ["active", "archived"],
  archived: [], // terminal — reactivating an archived listing means creating a new one
};

export class InvalidStatusTransitionError extends Error {
  constructor(from: ListingStatus, to: ListingStatus) {
    super(`Cannot transition a listing from "${from}" to "${to}".`);
    this.name = "InvalidStatusTransitionError";
  }
}

export interface RequestContext {
  userId: string;
}

export interface CreateListingRequest {
  propertyId: string;
  listingType: ListingType;
  price: number;
  currency?: string;
  negotiable?: boolean;
  contactInfo?: unknown | null;
}

export interface ListingSearchInput {
  listingType?: ListingType;
  minPrice?: number;
  maxPrice?: number;
  locationNodeId?: string;
  propertyTypeId?: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBuildingAreaSqm?: number;
  maxBuildingAreaSqm?: number;
  minLandAreaSqm?: number;
  maxLandAreaSqm?: number;
  near?: { latitude: number; longitude: number; radiusMeters: number };
  limit: number;
  offset: number;
}

export interface PricePerSqm {
  /** null when the property has no recorded building area, or it's <= 0. */
  perBuildingSqm: number | null;
  /** null when the property has no recorded land area, or it's <= 0. */
  perLandSqm: number | null;
}

/**
 * Pure function, exported independently of the service so it can be unit
 * tested directly with plain numbers — no repository, no service
 * construction needed. `price / buildingSize` and `price / landSize` are
 * computed independently (not one falling back to the other): a listing
 * for a property with both a building and land area has two genuinely
 * different, both-meaningful figures (e.g. an apartment's building-area
 * price per sqm vs. a house-with-yard's land-area price per sqm), and
 * conflating them would silently pick a possibly-wrong one for a given
 * property type. Zero or missing area is treated as "cannot be computed"
 * (null), never as a divide-by-zero error.
 */
export function calculatePricePerSqm(
  price: number,
  areas: { buildingAreaSqm: number | null; landAreaSqm: number | null }
): PricePerSqm {
  return {
    perBuildingSqm:
      areas.buildingAreaSqm !== null && areas.buildingAreaSqm > 0
        ? price / areas.buildingAreaSqm
        : null,
    perLandSqm:
      areas.landAreaSqm !== null && areas.landAreaSqm > 0
        ? price / areas.landAreaSqm
        : null,
  };
}

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase. `canManageAnyListing` mirrors propertyService's
 * `canManageAnyProperty`: an interim, flagged compromise defaulting to
 * `user:manage` as an administrative-override signal, pending a
 * dedicated permission — see docs/listing-domain.md.
 */
export function createListingService(
  repository: ListingRepository = prismaListingRepository,
  propertyRepository: PropertyRepository = prismaPropertyRepository,
  canManageAnyListing: (userId: string) => Promise<boolean> = (userId) =>
    policyService.can(userId, "user:manage")
) {
  async function assertCanModify(listing: ListingRecord, userId: string): Promise<void> {
    if (listing.agentUserId === userId) {
      return;
    }
    if (await canManageAnyListing(userId)) {
      return;
    }
    throw new ForbiddenListingActionError();
  }

  const service = {
    /**
     * `agentUserId` always comes from the authenticated caller, never
     * client input — same reasoning as propertyService.createProperty.
     * Verifies the target property actually exists first (a listing
     * pointing at a nonexistent property would otherwise fail at the
     * database's foreign-key check with a much less useful error).
     */
    async createListing(
      input: CreateListingRequest,
      context: RequestContext
    ): Promise<ListingRecord> {
      const property = await propertyRepository.findById(input.propertyId);
      if (!property) {
        throw new PropertyNotFoundForListingError();
      }

      return repository.create({
        propertyId: input.propertyId,
        agentUserId: context.userId,
        listingType: input.listingType,
        price: input.price,
        currency: input.currency,
        negotiable: input.negotiable,
        contactInfo: input.contactInfo,
      });
    },

    async getListing(id: string): Promise<ListingRecord | null> {
      return repository.findById(id);
    },

    /**
     * The public detail lookup: only ever returns an `active` listing on
     * a `published` property — a listing whose property was archived
     * (or never published) shouldn't be publicly visible even if the
     * listing itself is still marked active, and vice versa. Not found,
     * not forbidden — same reasoning as propertyService's
     * getPublishedProperty.
     */
    async getPublicListing(id: string): Promise<ListingRecord | null> {
      const listing = await repository.findById(id);
      if (!listing || listing.status !== "active") {
        return null;
      }
      const property = await propertyRepository.findById(listing.propertyId);
      if (!property || property.publicationStatus !== "published") {
        return null;
      }
      return listing;
    },

    /**
     * Public search: always restricted to `active` listings on
     * `published` properties, combining Listing-level filters (price,
     * type) with Property-level filters (location, size, spatial
     * proximity) in one query — the literal Task 6 requirement.
     */
    async search(input: ListingSearchInput): Promise<ListingRecord[]> {
      return repository.search({
        listingType: input.listingType,
        status: "active",
        requirePublishedProperty: true,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        locationNodeId: input.locationNodeId,
        propertyTypeId: input.propertyTypeId,
        minBedrooms: input.minBedrooms,
        maxBedrooms: input.maxBedrooms,
        minBuildingAreaSqm: input.minBuildingAreaSqm,
        maxBuildingAreaSqm: input.maxBuildingAreaSqm,
        minLandAreaSqm: input.minLandAreaSqm,
        maxLandAreaSqm: input.maxLandAreaSqm,
        near: input.near
          ? {
              center: { latitude: input.near.latitude, longitude: input.near.longitude },
              radiusMeters: input.near.radiusMeters,
            }
          : undefined,
        limit: input.limit,
        offset: input.offset,
      });
    },

    async updateDetails(
      id: string,
      patch: UpdateListingDetailsInput,
      context: RequestContext
    ): Promise<ListingRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ListingNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      const updated = await repository.updateDetails(id, patch);
      if (!updated) {
        throw new ListingNotFoundError();
      }
      return updated;
    },

    async updateStatus(
      id: string,
      status: ListingStatus,
      context: RequestContext
    ): Promise<ListingRecord> {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ListingNotFoundError();
      }
      await assertCanModify(existing, context.userId);

      if (!ALLOWED_STATUS_TRANSITIONS[existing.status].includes(status)) {
        throw new InvalidStatusTransitionError(existing.status, status);
      }

      const updated = await repository.updateStatus(id, status);
      if (!updated) {
        throw new ListingNotFoundError();
      }
      return updated;
    },

    /**
     * "Delete," per this project's established soft-deactivation
     * principle (Task 2, reaffirmed in Task 5 for Property): archives
     * rather than issuing a real SQL DELETE. Delegates to `updateStatus`
     * (not a bare repository call) so the same state-machine/ownership
     * checks apply — archiving is just another status transition, not a
     * special case.
     */
    async archiveListing(id: string, context: RequestContext): Promise<ListingRecord> {
      return service.updateStatus(id, "archived", context);
    },

    /**
     * Computes price-per-sqm for an existing listing by fetching its
     * associated property. Returns null (not an error) if the listing or
     * its property can't be found — callers that already have both
     * records in hand should just call `calculatePricePerSqm` directly
     * instead of going through the database again.
     */
    async getPricePerSqm(listingId: string): Promise<PricePerSqm | null> {
      const listing = await repository.findById(listingId);
      if (!listing) {
        return null;
      }
      const property = await propertyRepository.findById(listing.propertyId);
      if (!property) {
        return null;
      }
      return calculatePricePerSqm(listing.price, {
        buildingAreaSqm: property.buildingAreaSqm,
        landAreaSqm: property.landAreaSqm,
      });
    },
  };

  return service;
}

export const listingService = createListingService();
