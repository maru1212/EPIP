import { describe, expect, it, vi } from "vitest";
import {
  createValuationService,
  PropertyNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationReportNotFoundError,
  ForbiddenValuationActionError,
  ValuationRateLimitExceededError,
} from "@/modules/valuation/services/valuationService";
import { createFakeRateLimiter } from "../../helpers/fakeRateLimiter";
import type {
  ValuationRepository,
  ValuationReportRecord,
  ComparableListing,
} from "@/modules/valuation/repositories/valuationRepository";
import type { PropertyRepository, PropertyRecord } from "@/modules/property/repositories/propertyRepository";

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

function makeReport(overrides: Partial<ValuationReportRecord> = {}): ValuationReportRecord {
  return {
    id: "report-1",
    propertyId: "prop-1",
    requestedByUserId: null,
    estimatedValue: 5_000_000,
    lowEstimate: 4_500_000,
    highEstimate: 5_500_000,
    confidenceScore: 0.7,
    methodology: "comparable_sales",
    status: "completed",
    rawAiResponse: null,
    valuationData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeComparable(overrides: Partial<ComparableListing> = {}): ComparableListing {
  return {
    listingId: "listing-1",
    propertyId: "comp-prop-1",
    price: 5_000_000,
    buildingAreaSqm: 100,
    landAreaSqm: null,
    condition: "good",
    distanceMeters: 500,
    displayAddress: null,
    ...overrides,
  };
}

function createFakePropertyRepository(seed: PropertyRecord[] = []): PropertyRepository {
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

function createFakeValuationRepository(options: {
  comparables?: ComparableListing[];
  reports?: ValuationReportRecord[];
} = {}): ValuationRepository & { createReportCalls: unknown[] } {
  const reports = new Map((options.reports ?? []).map((r) => [r.id, r]));
  const createReportCalls: unknown[] = [];
  let nextId = reports.size + 1;

  return {
    createReportCalls,
    async findComparableListings() {
      return options.comparables ?? [];
    },
    async createReport(input) {
      createReportCalls.push(input);
      const record = makeReport({
        id: `report-${nextId++}`,
        propertyId: input.propertyId,
        requestedByUserId: input.requestedByUserId ?? null,
        estimatedValue: input.estimatedValue,
        lowEstimate: input.lowEstimate,
        highEstimate: input.highEstimate,
        confidenceScore: input.confidenceScore,
        valuationData: input.valuationData ?? null,
      });
      reports.set(record.id, record);
      return record;
    },
    async findById(id: string) {
      return reports.get(id) ?? null;
    },
    async findLatestByPropertyId(propertyId: string) {
      const matches = Array.from(reports.values())
        .filter((r) => r.propertyId === propertyId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return matches[0] ?? null;
    },
    async updateAiEnrichment(reportId: string, input) {
      const existing = reports.get(reportId);
      if (!existing) return null;
      const updated = {
        ...existing,
        rawAiResponse: input.rawAiResponse,
        valuationData: {
          ...(typeof existing.valuationData === "object" && existing.valuationData !== null
            ? existing.valuationData
            : {}),
          narrative: input.narrative,
          aiProvider: input.providerName,
        },
        updatedAt: new Date(),
      };
      reports.set(reportId, updated);
      return updated;
    },
  };
}

describe("valuationService.estimateValue", () => {
  it("throws PropertyNotFoundForValuationError for a nonexistent property", async () => {
    const propertyRepo = createFakePropertyRepository([]);
    const valuationRepo = createFakeValuationRepository();
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    await expect(
      service.estimateValue("nonexistent", { ip: "1.2.3.4" })
    ).rejects.toBeInstanceOf(PropertyNotFoundForValuationError);
  });

  it("throws PropertyHasNoUsableAreaError when the property has neither building nor land area", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: null, landAreaSqm: null }),
    ]);
    const valuationRepo = createFakeValuationRepository();
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    await expect(
      service.estimateValue("prop-1", { ip: "1.2.3.4" })
    ).rejects.toBeInstanceOf(PropertyHasNoUsableAreaError);
  });

  it("does not persist a report when there are zero comparables", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({ comparables: [] });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    const outcome = await service.estimateValue("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(false);
    expect(valuationRepo.createReportCalls).toHaveLength(0);
  });

  it("persists a report with the caller's userId when comparables exist and a session is present", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({
      comparables: [makeComparable(), makeComparable({ listingId: "listing-2" })],
    });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    const outcome = await service.estimateValue("prop-1", {
      userId: "user-42",
      ip: "1.2.3.4",
    });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.report.requestedByUserId).toBe("user-42");
    }
  });

  it("persists an anonymous report (requestedByUserId null) when no session is present", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({
      comparables: [makeComparable()],
    });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    const outcome = await service.estimateValue("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.report.requestedByUserId).toBeNull();
    }
  });

  it("uses land area when building area is absent", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: null, landAreaSqm: 200 }),
    ]);
    const findComparablesSpy = vi.fn().mockResolvedValue([
      makeComparable({ buildingAreaSqm: null, landAreaSqm: 150 }),
    ]);
    const valuationRepo: ValuationRepository = {
      findComparableListings: findComparablesSpy,
      async createReport(input) {
        return makeReport({ propertyId: input.propertyId });
      },
      async findById() {
        return null;
      },
      async findLatestByPropertyId() {
        return null;
      },
      async updateAiEnrichment() {
        return null;
      },
    };
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    await service.estimateValue("prop-1", { ip: "1.2.3.4" });

    expect(findComparablesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ areaType: "land" })
    );
  });

  it("throws ValuationRateLimitExceededError once the per-IP limit is hit", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({
      comparables: [makeComparable()],
    });
    const limiter = createFakeRateLimiter();
    // Exhaust the limit for this IP's key ahead of time.
    limiter.counts.set("valuation:estimate:ip:9.9.9.9", 1_000_000);
    const service = createValuationService(valuationRepo, propertyRepo, limiter);

    await expect(
      service.estimateValue("prop-1", { ip: "9.9.9.9" })
    ).rejects.toBeInstanceOf(ValuationRateLimitExceededError);
  });
});

describe("valuationService.analyzeListingPrice", () => {
  it("returns sufficient:false for zero comparables, without throwing", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({ comparables: [] });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    const outcome = await service.analyzeListingPrice(
      "prop-1",
      5_000_000,
      { ip: "1.2.3.4" }
    );

    expect(outcome.sufficient).toBe(false);
  });

  it("does not persist anything (stateless analysis)", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({
      comparables: [makeComparable()],
    });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    await service.analyzeListingPrice("prop-1", 8_000_000, { ip: "1.2.3.4" });

    expect(valuationRepo.createReportCalls).toHaveLength(0);
  });

  it("classifies overpriced vs underpriced correctly through the full service path", async () => {
    const propertyRepo = createFakePropertyRepository([
      makeProperty({ buildingAreaSqm: 100 }),
    ]);
    const valuationRepo = createFakeValuationRepository({
      comparables: [makeComparable({ price: 5_000_000, buildingAreaSqm: 100 })],
    });
    const service = createValuationService(
      valuationRepo,
      propertyRepo,
      createFakeRateLimiter()
    );

    const overpriced = await service.analyzeListingPrice(
      "prop-1",
      10_000_000,
      { ip: "1.2.3.4" }
    );
    expect(overpriced.sufficient).toBe(true);
    if (overpriced.sufficient) {
      expect(overpriced.assessment).toBe("overpriced");
    }
  });
});

describe("valuationService.getReport", () => {
  it("returns the report when it has no requester (anonymous)", async () => {
    const valuationRepo = createFakeValuationRepository({
      reports: [makeReport({ id: "report-1", requestedByUserId: null })],
    });
    const service = createValuationService(valuationRepo);

    await expect(
      service.getReport("report-1", { userId: "anyone" })
    ).resolves.toMatchObject({ id: "report-1" });
  });

  it("returns the report to its original requester", async () => {
    const valuationRepo = createFakeValuationRepository({
      reports: [makeReport({ id: "report-1", requestedByUserId: "user-1" })],
    });
    const service = createValuationService(valuationRepo);

    await expect(
      service.getReport("report-1", { userId: "user-1" })
    ).resolves.toMatchObject({ id: "report-1" });
  });

  it("rejects a different user without administrative override", async () => {
    const valuationRepo = createFakeValuationRepository({
      reports: [makeReport({ id: "report-1", requestedByUserId: "user-1" })],
    });
    const canViewAny = vi.fn().mockResolvedValue(false);
    const service = createValuationService(
      valuationRepo,
      undefined,
      undefined,
      canViewAny
    );

    await expect(
      service.getReport("report-1", { userId: "someone-else" })
    ).rejects.toBeInstanceOf(ForbiddenValuationActionError);
  });

  it("allows a non-requester with administrative override", async () => {
    const valuationRepo = createFakeValuationRepository({
      reports: [makeReport({ id: "report-1", requestedByUserId: "user-1" })],
    });
    const canViewAny = vi.fn().mockResolvedValue(true);
    const service = createValuationService(
      valuationRepo,
      undefined,
      undefined,
      canViewAny
    );

    await expect(
      service.getReport("report-1", { userId: "admin-1" })
    ).resolves.toMatchObject({ id: "report-1" });
  });

  it("throws ValuationReportNotFoundError for a nonexistent report", async () => {
    const valuationRepo = createFakeValuationRepository();
    const service = createValuationService(valuationRepo);

    await expect(
      service.getReport("nonexistent", { userId: "user-1" })
    ).rejects.toBeInstanceOf(ValuationReportNotFoundError);
  });
});
