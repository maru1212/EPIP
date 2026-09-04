import {
  prismaListingRepository,
  type ListingRepository,
  type ListingWithPropertyDetails,
  type ListingType,
} from "@/modules/listing/repositories/listingRepository";
import { calculatePricePerSqm } from "@/modules/listing/services/listingService";

export interface DiscoverySearchInput {
  locationNodeId?: string;
  propertyTypeId?: string;
  minPrice?: number;
  maxPrice?: number;
  listingType?: ListingType;
  minBedrooms?: number;
  minBathrooms?: number;
  minBuildingAreaSqm?: number;
  near?: { latitude: number; longitude: number; radiusMeters: number };
  limit: number;
  offset: number;
}

export interface DiscoveryResult {
  listingId: string;
  propertyId: string;
  listingType: ListingType;
  price: number;
  currency: string;
  negotiable: boolean;
  coordinates: { latitude: number; longitude: number } | null;
  buildingAreaSqm: number | null;
  landAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  condition: string | null;
  locationNodeId: string;
  propertyTypeId: string;
  pricePerSqm: { perBuildingSqm: number | null; perLandSqm: number | null };
}

function toDiscoveryResult(row: ListingWithPropertyDetails): DiscoveryResult {
  return {
    listingId: row.id,
    propertyId: row.propertyId,
    listingType: row.listingType,
    price: row.price,
    currency: row.currency,
    negotiable: row.negotiable,
    coordinates: row.coordinates,
    buildingAreaSqm: row.buildingAreaSqm,
    landAreaSqm: row.landAreaSqm,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    condition: row.condition,
    locationNodeId: row.locationNodeId,
    propertyTypeId: row.propertyTypeId,
    pricePerSqm: calculatePricePerSqm(row.price, {
      buildingAreaSqm: row.buildingAreaSqm,
      landAreaSqm: row.landAreaSqm,
    }),
  };
}

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase. Composes `listingRepository` rather than owning any
 * data access of its own; this module exists to combine Property and
 * Listing data into one discovery-oriented shape (Task 8's "aggregated
 * search"), not to introduce a new persistence concern.
 */
export function createSearchService(
  listingRepository: ListingRepository = prismaListingRepository
) {
  return {
    /**
     * Always restricted to `active` listings on `published` properties —
     * same public-search posture as property/listingService, since this
     * is an unauthenticated-accessible endpoint with no session to
     * distinguish an owner from a stranger.
     */
    async searchProperties(input: DiscoverySearchInput): Promise<DiscoveryResult[]> {
      const rows = await listingRepository.searchWithPropertyDetails({
        locationNodeId: input.locationNodeId,
        propertyTypeId: input.propertyTypeId,
        listingType: input.listingType,
        status: "active",
        requirePublishedProperty: true,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        minBedrooms: input.minBedrooms,
        minBathrooms: input.minBathrooms,
        minBuildingAreaSqm: input.minBuildingAreaSqm,
        near: input.near
          ? {
              center: { latitude: input.near.latitude, longitude: input.near.longitude },
              radiusMeters: input.near.radiusMeters,
            }
          : undefined,
        limit: input.limit,
        offset: input.offset,
      });

      return rows.map(toDiscoveryResult);
    },
  };
}

export const searchService = createSearchService();
