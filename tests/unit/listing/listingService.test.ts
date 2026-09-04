import { describe, expect, it, vi } from "vitest";
import {
  createListingService,
  calculatePricePerSqm,
  ListingNotFoundError,
  ForbiddenListingActionError,
  InvalidStatusTransitionError,
  PropertyNotFoundForListingError,
} from "@/modules/listing/services/listingService";
import type {
  ListingRepository,
  ListingRecord,
  CreateListingInput,
  UpdateListingDetailsInput,
  ListingStatus,
} from "@/modules/listing/repositories/listingRepository";
import type { PropertyRepository, PropertyRecord } from "@/modules/property/repositories/propertyRepository";

function makeListing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: "listing-1",
    propertyId: "prop-1",
    agentUserId: "agent-1",
    listingType: "sale",
    price: 1_000_000,
    currency: "ETB",
    negotiable: false,
    status: "draft",
    contactInfo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProperty(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: "prop-1",
    locationNodeId: "loc-1",
    propertyTypeId: "type-1",
    ownerUserId: null,
    coordinates: null,
    landAreaSqm: null,
    buildingAreaSqm: null,
    bedrooms: null,
    bathrooms: null,
    parkingSpaces: null,
    floor: null,
    yearBuilt: null,
    condition: null,
    constructionStatus: null,
    displayAddress: null,
    landmark: null,
    addressDescription: null,
    publicationStatus: "published",
    verificationStatus: "unverified",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeListingRepository(seed: ListingRecord[] = []): ListingRepository & {
  records: Map<string, ListingRecord>;
} {
  const records = new Map(seed.map((r) => [r.id, r]));
  let nextId = seed.length + 1;
  return {
    records,
    async create(input: CreateListingInput) {
      const record = makeListing({
        id: `listing-${nextId++}`,
        propertyId: input.propertyId,
        agentUserId: input.agentUserId,
        listingType: input.listingType,
        price: input.price,
        currency: input.currency ?? "ETB",
        negotiable: input.negotiable ?? false,
        status: input.status ?? "draft",
        contactInfo: input.contactInfo ?? null,
      });
      records.set(record.id, record);
      return record;
    },
    async findById(id: string) {
      return records.get(id) ?? null;
    },
    async search() {
      return Array.from(records.values()).filter((r) => r.status === "active");
    },
    async searchWithPropertyDetails() {
      return [];
    },
    async updateDetails(id: string, patch: UpdateListingDetailsInput) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      records.set(id, updated);
      return updated;
    },
    async updateStatus(id: string, status: ListingStatus) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, status, updatedAt: new Date() };
      records.set(id, updated);
      return updated;
    },
  };
}

function createFakePropertyRepository(
  seed: PropertyRecord[] = []
): PropertyRepository {
  const records = new Map(seed.map((r) => [r.id, r]));
  return {
    async create() {
      throw new Error("not needed for these tests");
    },
    async findById(id: string) {
      return records.get(id) ?? null;
    },
    async search() {
      return [];
    },
    async updateDetails() {
      return null;
    },
    async updateCoordinates() {
      return null;
    },
    async updatePublicationStatus() {
      return null;
    },
    async findWithinRadius() {
      return [];
    },
  };
}

describe("calculatePricePerSqm", () => {
  it("computes both building and land price-per-sqm when both areas are known", () => {
    const result = calculatePricePerSqm(1_200_000, {
      buildingAreaSqm: 120,
      landAreaSqm: 300,
    });
    expect(result.perBuildingSqm).toBe(10_000);
    expect(result.perLandSqm).toBe(4_000);
  });

  it("returns null for building sqm when buildingAreaSqm is null", () => {
    const result = calculatePricePerSqm(1_000_000, {
      buildingAreaSqm: null,
      landAreaSqm: 200,
    });
    expect(result.perBuildingSqm).toBeNull();
    expect(result.perLandSqm).toBe(5_000);
  });

  it("returns null for both when both areas are null", () => {
    const result = calculatePricePerSqm(1_000_000, {
      buildingAreaSqm: null,
      landAreaSqm: null,
    });
    expect(result.perBuildingSqm).toBeNull();
    expect(result.perLandSqm).toBeNull();
  });

  it("treats zero area as unusable (null), not a divide-by-zero error", () => {
    const result = calculatePricePerSqm(1_000_000, {
      buildingAreaSqm: 0,
      landAreaSqm: 0,
    });
    expect(result.perBuildingSqm).toBeNull();
    expect(result.perLandSqm).toBeNull();
    expect(Number.isFinite(result.perBuildingSqm)).toBe(false); // null, not Infinity
  });

  it("treats a negative area (data-entry error) as unusable, not a negative price-per-sqm", () => {
    const result = calculatePricePerSqm(1_000_000, {
      buildingAreaSqm: -50,
      landAreaSqm: null,
    });
    expect(result.perBuildingSqm).toBeNull();
  });
});

describe("listingService.createListing", () => {
  it("assigns agentUserId from the authenticated context, never from input", async () => {
    const listingRepo = createFakeListingRepository();
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    const created = await service.createListing(
      { propertyId: "prop-1", listingType: "sale", price: 2_000_000 },
      { userId: "real-caller" }
    );

    expect(created.agentUserId).toBe("real-caller");
  });

  it("throws PropertyNotFoundForListingError when the target property doesn't exist", async () => {
    const listingRepo = createFakeListingRepository();
    const propertyRepo = createFakePropertyRepository([]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(
      service.createListing(
        { propertyId: "nonexistent", listingType: "sale", price: 2_000_000 },
        { userId: "user-1" }
      )
    ).rejects.toBeInstanceOf(PropertyNotFoundForListingError);
  });
});

describe("listingService.getPublicListing", () => {
  it("returns an active listing on a published property", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", status: "active", propertyId: "prop-1" }),
    ]);
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ id: "prop-1", publicationStatus: "published" }),
    ]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(service.getPublicListing("listing-1")).resolves.not.toBeNull();
  });

  it("returns null for a draft listing", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", status: "draft" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(service.getPublicListing("listing-1")).resolves.toBeNull();
  });

  it("returns null for an active listing whose property isn't published", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", status: "active", propertyId: "prop-1" }),
    ]);
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ id: "prop-1", publicationStatus: "draft" }),
    ]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(service.getPublicListing("listing-1")).resolves.toBeNull();
  });
});

describe("listingService ownership authorization", () => {
  it("allows the listing's agent to update it", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createListingService(listingRepo, propertyRepo, canManageAny);

    await expect(
      service.updateDetails("listing-1", { price: 2_000_000 }, { userId: "agent-1" })
    ).resolves.toMatchObject({ price: 2_000_000 });
    expect(canManageAny).not.toHaveBeenCalled();
  });

  it("rejects a different user without administrative override", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createListingService(listingRepo, propertyRepo, canManageAny);

    await expect(
      service.updateDetails("listing-1", { price: 2_000_000 }, { userId: "someone-else" })
    ).rejects.toBeInstanceOf(ForbiddenListingActionError);
  });

  it("allows a non-agent with administrative override", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const canManageAny = vi.fn().mockResolvedValue(true);
    const service = createListingService(listingRepo, propertyRepo, canManageAny);

    await expect(
      service.updateDetails("listing-1", { price: 2_000_000 }, { userId: "admin-1" })
    ).resolves.toMatchObject({ price: 2_000_000 });
  });

  it("throws ListingNotFoundError before any ownership check for a nonexistent listing", async () => {
    const listingRepo = createFakeListingRepository();
    const propertyRepo = createFakePropertyRepository();
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createListingService(listingRepo, propertyRepo, canManageAny);

    await expect(
      service.updateDetails("nonexistent", { price: 1 }, { userId: "user-1" })
    ).rejects.toBeInstanceOf(ListingNotFoundError);
    expect(canManageAny).not.toHaveBeenCalled();
  });
});

describe("listingService status lifecycle", () => {
  it("allows draft -> active", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "draft" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    const updated = await service.updateStatus("listing-1", "active", { userId: "agent-1" });
    expect(updated.status).toBe("active");
  });

  it("allows active -> sold", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "active" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    const updated = await service.updateStatus("listing-1", "sold", { userId: "agent-1" });
    expect(updated.status).toBe("sold");
  });

  it("rejects sold -> active (a sold listing cannot go back on the market directly)", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "sold" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(
      service.updateStatus("listing-1", "active", { userId: "agent-1" })
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it("rejects any transition out of archived (terminal state)", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "archived" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    await expect(
      service.updateStatus("listing-1", "active", { userId: "agent-1" })
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it("archiveListing (soft-delete) sets status to archived, not a real delete", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "active" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const service = createListingService(listingRepo, propertyRepo);

    const archived = await service.archiveListing("listing-1", { userId: "agent-1" });
    expect(archived.status).toBe("archived");
    // still present in the repository, not removed
    expect(listingRepo.records.has("listing-1")).toBe(true);
  });

  it("enforces ownership on status transitions too", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", agentUserId: "agent-1", status: "draft" }),
    ]);
    const propertyRepo = createFakePropertyRepository([makeProperty()]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createListingService(listingRepo, propertyRepo, canManageAny);

    await expect(
      service.updateStatus("listing-1", "active", { userId: "someone-else" })
    ).rejects.toBeInstanceOf(ForbiddenListingActionError);
  });
});

describe("listingService.getPricePerSqm", () => {
  it("computes price-per-sqm from the listing's associated property", async () => {
    const listingRepo = createFakeListingRepository([
      makeListing({ id: "listing-1", propertyId: "prop-1", price: 1_200_000 }),
    ]);
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ id: "prop-1", buildingAreaSqm: 120, landAreaSqm: 300 }),
    ]);
    const service = createListingService(listingRepo, propertyRepo);

    const result = await service.getPricePerSqm("listing-1");
    expect(result?.perBuildingSqm).toBe(10_000);
    expect(result?.perLandSqm).toBe(4_000);
  });

  it("returns null when the listing doesn't exist", async () => {
    const listingRepo = createFakeListingRepository();
    const propertyRepo = createFakePropertyRepository();
    const service = createListingService(listingRepo, propertyRepo);

    await expect(service.getPricePerSqm("nonexistent")).resolves.toBeNull();
  });
});
