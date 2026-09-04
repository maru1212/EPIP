import { describe, expect, it, vi } from "vitest";
import {
  createPropertyService,
  PropertyNotFoundError,
  ForbiddenPropertyActionError,
} from "@/modules/property/services/propertyService";
import type {
  PropertyRepository,
  PropertyRecord,
  CreatePropertyInput,
  UpdatePropertyDetailsInput,
  PropertyPublicationStatus,
  Coordinates,
} from "@/modules/property/repositories/propertyRepository";

function makeRecord(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: "prop-1",
    locationNodeId: "loc-1",
    propertyTypeId: "type-1",
    ownerUserId: "owner-1",
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
    publicationStatus: "draft",
    verificationStatus: "unverified",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A real (if simple) in-memory implementation, not a mock. */
function createFakeRepository(seed: PropertyRecord[] = []): PropertyRepository & {
  records: Map<string, PropertyRecord>;
} {
  const records = new Map(seed.map((r) => [r.id, r]));
  let nextId = seed.length + 1;

  return {
    records,
    async create(input: CreatePropertyInput) {
      const record = makeRecord({
        id: `prop-${nextId++}`,
        locationNodeId: input.locationNodeId,
        propertyTypeId: input.propertyTypeId,
        ownerUserId: input.ownerUserId ?? null,
        coordinates: input.coordinates ?? null,
        bedrooms: input.bedrooms ?? null,
        publicationStatus: input.publicationStatus ?? "draft",
      });
      records.set(record.id, record);
      return record;
    },
    async findById(id: string) {
      return records.get(id) ?? null;
    },
    async search() {
      return Array.from(records.values()).filter(
        (r) => r.publicationStatus === "published"
      );
    },
    async updateDetails(id: string, patch: UpdatePropertyDetailsInput) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      records.set(id, updated);
      return updated;
    },
    async updateCoordinates(id: string, coordinates: Coordinates | null) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, coordinates, updatedAt: new Date() };
      records.set(id, updated);
      return updated;
    },
    async updatePublicationStatus(id: string, status: PropertyPublicationStatus) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, publicationStatus: status, updatedAt: new Date() };
      records.set(id, updated);
      return updated;
    },
    async findWithinRadius() {
      return [];
    },
  };
}

describe("propertyService.createProperty", () => {
  it("always assigns ownerUserId from the authenticated context, never from input", async () => {
    const repository = createFakeRepository();
    const service = createPropertyService(repository);

    const created = await service.createProperty(
      { locationNodeId: "loc-1", propertyTypeId: "type-1" },
      { userId: "real-caller" }
    );

    expect(created.ownerUserId).toBe("real-caller");
  });

  it("defaults publicationStatus to draft", async () => {
    const repository = createFakeRepository();
    const service = createPropertyService(repository);

    const created = await service.createProperty(
      { locationNodeId: "loc-1", propertyTypeId: "type-1" },
      { userId: "user-1" }
    );

    expect(created.publicationStatus).toBe("draft");
  });
});

describe("propertyService.getPublishedProperty", () => {
  it("returns a published property", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", publicationStatus: "published" }),
    ]);
    const service = createPropertyService(repository);

    await expect(service.getPublishedProperty("prop-1")).resolves.not.toBeNull();
  });

  it("returns null for a draft property (treated as not found, not forbidden)", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", publicationStatus: "draft" }),
    ]);
    const service = createPropertyService(repository);

    await expect(service.getPublishedProperty("prop-1")).resolves.toBeNull();
  });

  it("returns null for a nonexistent property", async () => {
    const repository = createFakeRepository();
    const service = createPropertyService(repository);

    await expect(service.getPublishedProperty("nonexistent")).resolves.toBeNull();
  });
});

describe("propertyService ownership authorization", () => {
  it("allows the owner to update their own property", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1" }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateDetails("prop-1", { bedrooms: 5 }, { userId: "owner-1" })
    ).resolves.toMatchObject({ bedrooms: 5 });
    // Ownership alone was sufficient — the admin-check function was
    // never even consulted.
    expect(canManageAny).not.toHaveBeenCalled();
  });

  it("rejects a non-owner without administrative override", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1" }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateDetails("prop-1", { bedrooms: 5 }, { userId: "someone-else" })
    ).rejects.toBeInstanceOf(ForbiddenPropertyActionError);
    expect(canManageAny).toHaveBeenCalledWith("someone-else");
  });

  it("allows a non-owner with administrative override (e.g. platform_admin)", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1" }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(true);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateDetails("prop-1", { bedrooms: 5 }, { userId: "admin-1" })
    ).resolves.toMatchObject({ bedrooms: 5 });
  });

  it("allows any authenticated user to modify a property with no recorded owner", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: null }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateDetails("prop-1", { bedrooms: 5 }, { userId: "anyone" })
    ).resolves.toMatchObject({ bedrooms: 5 });
  });

  it("throws PropertyNotFoundError for a nonexistent property before any ownership check", async () => {
    const repository = createFakeRepository();
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateDetails("nonexistent", { bedrooms: 5 }, { userId: "user-1" })
    ).rejects.toBeInstanceOf(PropertyNotFoundError);
    expect(canManageAny).not.toHaveBeenCalled();
  });

  it("applies the same ownership rule to updateCoordinates", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1" }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updateCoordinates(
        "prop-1",
        { latitude: 9.01, longitude: 38.79 },
        { userId: "someone-else" }
      )
    ).rejects.toBeInstanceOf(ForbiddenPropertyActionError);
  });

  it("applies the same ownership rule to updatePublicationStatus", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1" }),
    ]);
    const canManageAny = vi.fn().mockResolvedValue(false);
    const service = createPropertyService(repository, canManageAny);

    await expect(
      service.updatePublicationStatus("prop-1", "published", { userId: "someone-else" })
    ).rejects.toBeInstanceOf(ForbiddenPropertyActionError);
  });

  it("applies the same ownership rule to archiveProperty, and sets status to archived", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", ownerUserId: "owner-1", publicationStatus: "published" }),
    ]);
    const service = createPropertyService(repository);

    const archived = await service.archiveProperty("prop-1", { userId: "owner-1" });
    expect(archived.publicationStatus).toBe("archived");
  });
});

describe("propertyService.search", () => {
  it("always forces publicationStatus to published, regardless of caller", async () => {
    const repository = createFakeRepository([
      makeRecord({ id: "prop-1", publicationStatus: "published" }),
      makeRecord({ id: "prop-2", publicationStatus: "draft" }),
    ]);
    const searchSpy = vi.spyOn(repository, "search");
    const service = createPropertyService(repository);

    await service.search({ limit: 20, offset: 0 });

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ publicationStatus: "published" })
    );
  });

  it("builds a near filter only when provided", async () => {
    const repository = createFakeRepository();
    const searchSpy = vi.spyOn(repository, "search");
    const service = createPropertyService(repository);

    await service.search({
      near: { latitude: 9.01, longitude: 38.79, radiusMeters: 2000 },
      limit: 20,
      offset: 0,
    });

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        near: { center: { latitude: 9.01, longitude: 38.79 }, radiusMeters: 2000 },
      })
    );
  });
});
