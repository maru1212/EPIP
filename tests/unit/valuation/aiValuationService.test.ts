import { describe, expect, it, vi } from "vitest";
import { createAiValuationService } from "@/modules/valuation/services/aiValuationService";
import { AIProviderError, type AIValuationProvider } from "@/modules/valuation/services/aiProviders/aiProvider";
import type {
  ValuationRepository,
  ValuationReportRecord,
} from "@/modules/valuation/repositories/valuationRepository";
import type { PropertyRepository, PropertyRecord } from "@/modules/property/repositories/propertyRepository";
import type { StatisticalEstimator } from "@/modules/valuation/services/aiValuationService";

function makeReport(overrides: Partial<ValuationReportRecord> = {}): ValuationReportRecord {
  return {
    id: "report-1",
    propertyId: "prop-1",
    requestedByUserId: null,
    estimatedValue: 5_000_000,
    lowEstimate: 4_500_000,
    highEstimate: 5_500_000,
    confidenceScore: 0.75,
    methodology: "comparable_sales",
    status: "completed",
    rawAiResponse: null,
    valuationData: {
      medianPricePerSqm: 50_000,
      comparableCount: 4,
      coefficientOfVariation: 0.1,
    },
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
    buildingAreaSqm: 100,
    bedrooms: 3,
    bathrooms: 2,
    parkingSpaces: null,
    floor: null,
    yearBuilt: null,
    condition: "good",
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

function createFakePropertyRepository(seed: PropertyRecord[] = []): PropertyRepository {
  const records = new Map(seed.map((r) => [r.id, r]));
  return {
    async create() {
      throw new Error("not needed");
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

function createFakeValuationRepository(): ValuationRepository & {
  updateAiEnrichmentCalls: unknown[];
} {
  const updateAiEnrichmentCalls: unknown[] = [];
  return {
    updateAiEnrichmentCalls,
    async findComparableListings() {
      return [];
    },
    async createReport(input) {
      return makeReport({ propertyId: input.propertyId });
    },
    async findById() {
      return null;
    },
    async findLatestByPropertyId() {
      return null;
    },
    async updateAiEnrichment(reportId, input) {
      updateAiEnrichmentCalls.push({ reportId, input });
      return makeReport({
        id: reportId,
        rawAiResponse: input.rawAiResponse,
        valuationData: {
          medianPricePerSqm: 50_000,
          comparableCount: 4,
          coefficientOfVariation: 0.1,
          narrative: input.narrative,
          aiProvider: input.providerName,
        },
      });
    },
  };
}

function createFakeEstimator(report: ValuationReportRecord | null = makeReport()): StatisticalEstimator {
  return {
    async estimateValue() {
      if (!report) {
        return { persisted: false, comparableCount: 0, reason: "insufficient_comparable_data" };
      }
      return { persisted: true, report, comparableCount: 4 };
    },
    async getReport(id: string) {
      if (!report || report.id !== id) {
        throw new Error("not found in this fake");
      }
      return report;
    },
  };
}

function createFakeLookup(): import("@/modules/valuation/services/aiValuationService").LocationAndTypeLookup {
  return {
    async getLocationChain() {
      return ["Bole", "Addis Ababa"];
    },
    async getPropertyTypeKey() {
      return "apartment";
    },
  };
}

function createFakeAIProvider(
  implementation: AIValuationProvider["generateNarrative"]
): AIValuationProvider {
  return { name: "fake", generateNarrative: implementation };
}

describe("aiValuationService.generateAiReport", () => {
  it("returns the insufficient-data outcome untouched when the statistical step has no data", async () => {
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository([makeProperty()]),
      createFakeEstimator(null),
      createFakeAIProvider(async () => {
        throw new Error("should not be called");
      }),
      5000,
      createFakeLookup()
    );

    const outcome = await service.generateAiReport("prop-1", { ip: "1.2.3.4" });
    expect(outcome.persisted).toBe(false);
  });

  it("persists the AI narrative and returns aiEnriched: true on success", async () => {
    const valuationRepo = createFakeValuationRepository();
    const service = createAiValuationService(
      valuationRepo,
      createFakePropertyRepository([makeProperty()]),
      createFakeEstimator(),
      createFakeAIProvider(async () => ({
        executiveSummary: "Summary",
        locationAnalysis: "Location",
        pricingFactors: "Pricing",
        confidenceExplanation: "Confidence",
      })),
      5000,
      createFakeLookup()
    );

    const outcome = await service.generateAiReport("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.aiEnriched).toBe(true);
      if (outcome.aiEnriched) {
        expect(outcome.report.valuationData).toMatchObject({
          narrative: { executiveSummary: "Summary" },
        });
      }
    }
    expect(valuationRepo.updateAiEnrichmentCalls).toHaveLength(1);
  });

  it("falls back to the statistical report with aiEnriched: false when the provider throws, never throwing itself", async () => {
    const valuationRepo = createFakeValuationRepository();
    const service = createAiValuationService(
      valuationRepo,
      createFakePropertyRepository([makeProperty()]),
      createFakeEstimator(),
      createFakeAIProvider(async () => {
        throw new AIProviderError("Simulated provider failure.");
      }),
      5000,
      createFakeLookup()
    );

    const outcome = await service.generateAiReport("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.aiEnriched).toBe(false);
      if (!outcome.aiEnriched) {
        expect(outcome.reason).toContain("Simulated provider failure");
        expect(outcome.report.id).toBe("report-1"); // the original statistical report, untouched
      }
    }
    // Enrichment was never persisted — the failure happened before that step.
    expect(valuationRepo.updateAiEnrichmentCalls).toHaveLength(0);
  });

  it("falls back gracefully when the provider times out", async () => {
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository([makeProperty()]),
      createFakeEstimator(),
      createFakeAIProvider(
        () => new Promise((resolve) => setTimeout(resolve, 200)) as never // never resolves in time
      ),
      50, // 50ms timeout, provider takes 200ms
      createFakeLookup()
    );

    const outcome = await service.generateAiReport("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.aiEnriched).toBe(false);
      if (!outcome.aiEnriched) {
        expect(outcome.reason).toContain("did not respond within");
      }
    }
  });

  it("falls back gracefully when the provider returns a completely unexpected error type", async () => {
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository([makeProperty()]),
      createFakeEstimator(),
      createFakeAIProvider(async () => {
        throw new TypeError("Some totally unrelated bug");
      }),
      5000,
      createFakeLookup()
    );

    const outcome = await service.generateAiReport("prop-1", { ip: "1.2.3.4" });

    expect(outcome.persisted).toBe(true);
    if (outcome.persisted) {
      expect(outcome.aiEnriched).toBe(false);
      if (!outcome.aiEnriched) {
        // Generic, safe message — not the raw internal error text.
        expect(outcome.reason).not.toContain("Some totally unrelated bug");
      }
    }
  });

  it("passes the report's persisted statistical context through to the provider", async () => {
    const generateNarrativeSpy = vi.fn().mockResolvedValue({
      executiveSummary: "s",
      locationAnalysis: "l",
      pricingFactors: "p",
      confidenceExplanation: "c",
    });
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository([makeProperty({ bedrooms: 4, condition: "excellent" })]),
      createFakeEstimator(makeReport({ estimatedValue: 7_000_000 })),
      createFakeAIProvider(generateNarrativeSpy),
      5000,
      createFakeLookup()
    );

    await service.generateAiReport("prop-1", { ip: "1.2.3.4" });

    expect(generateNarrativeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedValue: 7_000_000,
        bedrooms: 4,
        condition: "excellent",
        medianComparablePricePerSqm: 50_000,
        comparableCount: 4,
      })
    );
  });
});

describe("aiValuationService.getAiSummary", () => {
  it("returns aiEnriched: false when the report has no narrative yet", async () => {
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository(),
      createFakeEstimator(makeReport({ valuationData: { medianPricePerSqm: 50_000 } })),
      createFakeAIProvider(async () => {
        throw new Error("not used");
      })
    );

    const summary = await service.getAiSummary("report-1", { userId: "user-1" });

    expect(summary.aiEnriched).toBe(false);
    expect(summary.narrative).toBeNull();
  });

  it("returns aiEnriched: true with the narrative when present", async () => {
    const narrative = {
      executiveSummary: "s",
      locationAnalysis: "l",
      pricingFactors: "p",
      confidenceExplanation: "c",
    };
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository(),
      createFakeEstimator(
        makeReport({ valuationData: { medianPricePerSqm: 50_000, narrative, aiProvider: "mock" } })
      ),
      createFakeAIProvider(async () => {
        throw new Error("not used");
      })
    );

    const summary = await service.getAiSummary("report-1", { userId: "user-1" });

    expect(summary.aiEnriched).toBe(true);
    expect(summary.narrative).toEqual(narrative);
    expect(summary.aiProvider).toBe("mock");
  });

  it("propagates not-found/forbidden errors from the underlying getReport call", async () => {
    const service = createAiValuationService(
      createFakeValuationRepository(),
      createFakePropertyRepository(),
      createFakeEstimator(makeReport({ id: "report-1" })),
      createFakeAIProvider(async () => {
        throw new Error("not used");
      })
    );

    await expect(service.getAiSummary("nonexistent", { userId: "user-1" })).rejects.toThrow();
  });
});
