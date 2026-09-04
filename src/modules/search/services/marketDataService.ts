import {
  prismaMarketDataRepository,
  type MarketDataRepository,
} from "../repositories/marketDataRepository";

export interface CategoryStats {
  category: "residential" | "commercial" | "land" | "other";
  activeListingCount: number;
  medianPricePerSqm: number | null;
}

export interface NeighborhoodStats {
  locationNodeId: string;
  /** How many LocationNodes (including the queried one) were aggregated over. */
  includedLocationNodeCount: number;
  activeListingCount: number;
  medianPrice: number | null;
  medianPricePerSqm: number | null;
  /**
   * The range of CURRENTLY active listing prices — not a time-series
   * history. No PriceHistory table exists yet (deferred since Task 6);
   * "historical range" from the Task 8 spec is delivered as this current
   * snapshot range instead. See docs/search-and-b2b-domain.md.
   */
  priceRange: { min: number | null; max: number | null };
  /**
   * Task 12's dashboard asks for price/m² broken down across property
   * types (Residential/Commercial/Land). Only categories with at least
   * one active listing are included — an empty array means no active
   * listings anywhere in this location's subtree, same underlying
   * "no data" case as the top-level stats above.
   */
  categoryBreakdown: CategoryStats[];
  /**
   * No PriceHistory table exists (deferred since Task 6 — see
   * docs/search-and-b2b-domain.md §6) so there is no real historical
   * trend to report. Always "unavailable" today; documented explicitly
   * rather than fabricating an up/down indicator. A real trend requires
   * time-series price data this project doesn't collect yet.
   */
  trendDirection: "unavailable";
}

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase, so this can be tested with a fake repository. All
 * database access lives in `marketDataRepository.ts`; this layer is
 * purely composition/shaping, per the established
 * routes -> services -> repositories -> database layering.
 */
export function createMarketDataService(
  repository: MarketDataRepository = prismaMarketDataRepository
) {
  return {
    /** Returns null if `locationNodeId` doesn't exist. */
    async getNeighborhoodStats(locationNodeId: string): Promise<NeighborhoodStats | null> {
      const exists = await repository.locationNodeExists(locationNodeId);
      if (!exists) {
        return null;
      }

      const [raw, categoryBreakdown] = await Promise.all([
        repository.getNeighborhoodStatsRaw(locationNodeId),
        repository.getCategoryBreakdown(locationNodeId),
      ]);

      return {
        locationNodeId,
        includedLocationNodeCount: raw.includedLocationNodeCount,
        activeListingCount: raw.activeListingCount,
        medianPrice: raw.medianPrice,
        medianPricePerSqm: raw.medianPricePerSqm,
        priceRange: { min: raw.minPrice, max: raw.maxPrice },
        categoryBreakdown,
        trendDirection: "unavailable",
      };
    },
  };
}

export const marketDataService = createMarketDataService();
