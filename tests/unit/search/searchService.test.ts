import { describe, expect, it, vi } from "vitest";
import { createSearchService } from "@/modules/search/services/searchService";
import type {
  ListingRepository,
  ListingWithPropertyDetails,
} from "@/modules/listing/repositories/listingRepository";

function makeListingWithProperty(
  overrides: Partial<ListingWithPropertyDetails> = {}
): ListingWithPropertyDetails {
  return {
    id: "listing-1",
    propertyId: "prop-1",
    agentUserId: "agent-1",
    listingType: "sale",
    price: 5_000_000,
    currency: "ETB",
    negotiable: false,
    status: "active",
    contactInfo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    coordinates: { latitude: 8.9979, longitude: 38.7969 },
    buildingAreaSqm: 100,
    landAreaSqm: null,
    bedrooms: 3,
    bathrooms: 2,
    locationNodeId: "loc-1",
    propertyTypeId: "type-1",
    condition: "good",
    ...overrides,
  };
}

function createFakeListingRepository(
  results: ListingWithPropertyDetails[] = []
): ListingRepository & { searchSpy: ReturnType<typeof vi.fn> } {
  const searchSpy = vi.fn().mockResolvedValue(results);
  return {
    searchSpy,
    async create() {
      throw new Error("not needed for these tests");
    },
    async findById() {
      return null;
    },
    async search() {
      return [];
    },
    searchWithPropertyDetails: searchSpy,
    async updateDetails() {
      return null;
    },
    async updateStatus() {
      return null;
    },
  };
}

describe("searchService.searchProperties", () => {
  it("always forces status:active and requirePublishedProperty:true, regardless of input", async () => {
    const repository = createFakeListingRepository([]);
    const service = createSearchService(repository);

    await service.searchProperties({ limit: 20, offset: 0 });

    expect(repository.searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", requirePublishedProperty: true })
    );
  });

  it("translates external filter names correctly and builds a near filter only when provided", async () => {
    const repository = createFakeListingRepository([]);
    const service = createSearchService(repository);

    await service.searchProperties({
      locationNodeId: "loc-1",
      propertyTypeId: "type-1",
      minPrice: 1_000_000,
      maxPrice: 15_000_000,
      minBedrooms: 2,
      near: { latitude: 8.9979, longitude: 38.7969, radiusMeters: 2000 },
      limit: 20,
      offset: 0,
    });

    expect(repository.searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        locationNodeId: "loc-1",
        propertyTypeId: "type-1",
        minPrice: 1_000_000,
        maxPrice: 15_000_000,
        minBedrooms: 2,
        near: {
          center: { latitude: 8.9979, longitude: 38.7969 },
          radiusMeters: 2000,
        },
      })
    );
  });

  it("computes pricePerSqm for each result using the property's area", async () => {
    const repository = createFakeListingRepository([
      makeListingWithProperty({ price: 5_000_000, buildingAreaSqm: 100, landAreaSqm: null }),
    ]);
    const service = createSearchService(repository);

    const results = await service.searchProperties({ limit: 20, offset: 0 });

    expect(results[0]!.pricePerSqm.perBuildingSqm).toBe(50_000);
    expect(results[0]!.pricePerSqm.perLandSqm).toBeNull();
  });

  it("includes spatial coordinates and core property metadata in each result", async () => {
    const repository = createFakeListingRepository([
      makeListingWithProperty({
        coordinates: { latitude: 8.9979, longitude: 38.7969 },
        bedrooms: 4,
        bathrooms: 3,
        condition: "excellent",
      }),
    ]);
    const service = createSearchService(repository);

    const results = await service.searchProperties({ limit: 20, offset: 0 });

    expect(results[0]!.coordinates).toEqual({ latitude: 8.9979, longitude: 38.7969 });
    expect(results[0]!.bedrooms).toBe(4);
    expect(results[0]!.bathrooms).toBe(3);
    expect(results[0]!.condition).toBe("excellent");
  });

  it("handles a listing with no area data gracefully (pricePerSqm all null, not an error)", async () => {
    const repository = createFakeListingRepository([
      makeListingWithProperty({ buildingAreaSqm: null, landAreaSqm: null }),
    ]);
    const service = createSearchService(repository);

    const results = await service.searchProperties({ limit: 20, offset: 0 });

    expect(results[0]!.pricePerSqm).toEqual({ perBuildingSqm: null, perLandSqm: null });
  });
});
