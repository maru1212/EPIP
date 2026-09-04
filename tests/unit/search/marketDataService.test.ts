import { describe, expect, it, vi } from "vitest";
import { createMarketDataService } from "@/modules/search/services/marketDataService";
import type {
  MarketDataRepository,
  NeighborhoodStatsRow,
  CategoryBreakdownRow,
} from "@/modules/search/repositories/marketDataRepository";

function makeStatsRow(overrides: Partial<NeighborhoodStatsRow> = {}): NeighborhoodStatsRow {
  return {
    includedLocationNodeCount: 1,
    activeListingCount: 0,
    medianPrice: null,
    medianPricePerSqm: null,
    minPrice: null,
    maxPrice: null,
    ...overrides,
  };
}

function createFakeRepository(options: {
  exists?: boolean;
  stats?: NeighborhoodStatsRow;
  categoryBreakdown?: CategoryBreakdownRow[];
}): MarketDataRepository {
  return {
    locationNodeExists: vi.fn().mockResolvedValue(options.exists ?? true),
    getNeighborhoodStatsRaw: vi.fn().mockResolvedValue(options.stats ?? makeStatsRow()),
    getCategoryBreakdown: vi.fn().mockResolvedValue(options.categoryBreakdown ?? []),
  };
}

describe("marketDataService.getNeighborhoodStats", () => {
  it("returns null when the location node doesn't exist, without querying stats", async () => {
    const repository = createFakeRepository({ exists: false });
    const service = createMarketDataService(repository);

    const result = await service.getNeighborhoodStats("nonexistent");

    expect(result).toBeNull();
    expect(repository.getNeighborhoodStatsRaw).not.toHaveBeenCalled();
  });

  it("shapes the repository's raw row into the public NeighborhoodStats structure", async () => {
    const repository = createFakeRepository({
      exists: true,
      stats: makeStatsRow({
        includedLocationNodeCount: 3,
        activeListingCount: 5,
        medianPrice: 5_000_000,
        medianPricePerSqm: 50_000,
        minPrice: 4_000_000,
        maxPrice: 6_000_000,
      }),
    });
    const service = createMarketDataService(repository);

    const result = await service.getNeighborhoodStats("loc-1");

    expect(result).toEqual({
      locationNodeId: "loc-1",
      includedLocationNodeCount: 3,
      activeListingCount: 5,
      medianPrice: 5_000_000,
      medianPricePerSqm: 50_000,
      priceRange: { min: 4_000_000, max: 6_000_000 },
      categoryBreakdown: [],
      trendDirection: "unavailable",
    });
  });

  it("passes through the repository's category breakdown unchanged", async () => {
    const repository = createFakeRepository({
      exists: true,
      categoryBreakdown: [
        { category: "residential", activeListingCount: 4, medianPricePerSqm: 48_000 },
        { category: "commercial", activeListingCount: 1, medianPricePerSqm: 65_000 },
      ],
    });
    const service = createMarketDataService(repository);

    const result = await service.getNeighborhoodStats("loc-1");

    expect(result!.categoryBreakdown).toEqual([
      { category: "residential", activeListingCount: 4, medianPricePerSqm: 48_000 },
      { category: "commercial", activeListingCount: 1, medianPricePerSqm: 65_000 },
    ]);
  });

  it("always reports trendDirection as unavailable — no fabricated historical trend", async () => {
    const repository = createFakeRepository({ exists: true });
    const service = createMarketDataService(repository);

    const result = await service.getNeighborhoodStats("loc-1");

    expect(result!.trendDirection).toBe("unavailable");
  });

  it("handles a location node with zero active listings gracefully (all null, not an error)", async () => {
    const repository = createFakeRepository({
      exists: true,
      stats: makeStatsRow({ includedLocationNodeCount: 2, activeListingCount: 0 }),
    });
    const service = createMarketDataService(repository);

    const result = await service.getNeighborhoodStats("loc-1");

    expect(result!.activeListingCount).toBe(0);
    expect(result!.medianPrice).toBeNull();
    expect(result!.priceRange).toEqual({ min: null, max: null });
  });
});
