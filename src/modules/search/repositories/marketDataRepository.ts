import { prisma } from "@/lib/db";

/**
 * Raw SQL, same reasoning as every other repository in this project under
 * the current sandbox constraint (see prisma/README.md): a schema-specific
 * Prisma Client cannot be generated here, so raw SQL — verifiable
 * directly against a live database — was used instead of ORM calls that
 * can't be verified at all here. The recursive descendant lookup and
 * `percentile_cont` aggregate also aren't expressible through Prisma's
 * relational query API regardless of environment.
 */

export interface NeighborhoodStatsRow {
  includedLocationNodeCount: number;
  activeListingCount: number;
  medianPrice: number | null;
  medianPricePerSqm: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface CategoryBreakdownRow {
  category: "residential" | "commercial" | "land" | "other";
  activeListingCount: number;
  medianPricePerSqm: number | null;
}

export interface MarketDataRepository {
  locationNodeExists(locationNodeId: string): Promise<boolean>;
  /**
   * Aggregates over `locationNodeId` and every descendant beneath it in
   * the LocationNode hierarchy (e.g. querying a subcity includes every
   * neighborhood under it) — the "neighborhood stats" access pattern from
   * the Task 8 spec. Assumes the node exists; call `locationNodeExists`
   * first if that needs to be distinguished from "exists but has no
   * data" (this always returns a row, since the aggregate functions
   * return NULL/0 for an empty set rather than no row at all).
   */
  getNeighborhoodStatsRaw(locationNodeId: string): Promise<NeighborhoodStatsRow>;
  /**
   * Task 12: the same aggregation as `getNeighborhoodStatsRaw`, grouped
   * by a coarse property-type category rather than across all types at
   * once. `property_types.key` is table-driven (Task 5) with no
   * "category" column of its own, so the grouping is a `CASE` over the
   * known seeded keys (apartment/house/villa -> residential,
   * commercial/office -> commercial, land -> land, everything else ->
   * other) rather than a schema change — see docs/b2b-portal.md.
   */
  getCategoryBreakdown(locationNodeId: string): Promise<CategoryBreakdownRow[]>;
}

async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  // Same stub-typing workaround as every other repository: the
  // un-generated Prisma Client stub types PrismaClient as `any`, so an
  // explicit generic argument on `$queryRawUnsafe<T>(...)` is a
  // TypeScript error. Casting the result instead preserves the same
  // effective typing at every call site.
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

interface StatsRow {
  descendant_count: string;
  active_listing_count: string;
  median_price: string | null;
  median_price_per_sqm: string | null;
  min_price: string | null;
  max_price: string | null;
}

export const prismaMarketDataRepository: MarketDataRepository = {
  async locationNodeExists(locationNodeId) {
    const rows = await queryRawUnsafe<{ id: string }>(
      `SELECT id FROM location_nodes WHERE id = $1`,
      locationNodeId
    );
    return rows.length > 0;
  },

  async getNeighborhoodStatsRaw(locationNodeId) {
    const rows = await queryRawUnsafe<StatsRow>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM location_nodes WHERE id = $1
         UNION ALL
         SELECT ln.id FROM location_nodes ln
         JOIN descendants d ON ln.parent_id = d.id
       )
       SELECT
         (SELECT count(*) FROM descendants) AS descendant_count,
         count(l.id) AS active_listing_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) AS median_price,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY l.price / p.building_area_sqm
         ) AS median_price_per_sqm,
         min(l.price) AS min_price,
         max(l.price) AS max_price
       FROM descendants d
       LEFT JOIN properties p
         ON p.location_node_id = d.id
         AND p.publication_status = 'published'::"PropertyPublicationStatus"
       LEFT JOIN listings l
         ON l.property_id = p.id
         AND l.status = 'active'::"ListingStatus"
         AND l.listing_type = 'sale'::"ListingType"
         AND p.building_area_sqm IS NOT NULL AND p.building_area_sqm > 0`,
      locationNodeId
    );

    const row = rows[0]!;
    return {
      includedLocationNodeCount: Number(row.descendant_count),
      activeListingCount: Number(row.active_listing_count),
      medianPrice: row.median_price !== null ? Number(row.median_price) : null,
      medianPricePerSqm:
        row.median_price_per_sqm !== null ? Number(row.median_price_per_sqm) : null,
      minPrice: row.min_price !== null ? Number(row.min_price) : null,
      maxPrice: row.max_price !== null ? Number(row.max_price) : null,
    };
  },

  async getCategoryBreakdown(locationNodeId) {
    const rows = await queryRawUnsafe<{
      category: string;
      active_listing_count: string;
      median_price_per_sqm: string | null;
    }>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM location_nodes WHERE id = $1
         UNION ALL
         SELECT ln.id FROM location_nodes ln
         JOIN descendants d ON ln.parent_id = d.id
       ),
       categorized AS (
         SELECT
           l.id AS listing_id,
           l.price,
           p.building_area_sqm,
           CASE pt.key
             WHEN 'apartment' THEN 'residential'
             WHEN 'house' THEN 'residential'
             WHEN 'villa' THEN 'residential'
             WHEN 'commercial' THEN 'commercial'
             WHEN 'office' THEN 'commercial'
             WHEN 'land' THEN 'land'
             ELSE 'other'
           END AS category
         FROM descendants d
         JOIN properties p
           ON p.location_node_id = d.id
           AND p.publication_status = 'published'::"PropertyPublicationStatus"
         JOIN property_types pt ON pt.id = p.property_type_id
         JOIN listings l
           ON l.property_id = p.id
           AND l.status = 'active'::"ListingStatus"
           AND l.listing_type = 'sale'::"ListingType"
           AND p.building_area_sqm IS NOT NULL AND p.building_area_sqm > 0
       )
       SELECT
         category,
         count(*) AS active_listing_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price / building_area_sqm) AS median_price_per_sqm
       FROM categorized
       GROUP BY category`,
      locationNodeId
    );

    return rows.map((row) => ({
      category: row.category as CategoryBreakdownRow["category"],
      activeListingCount: Number(row.active_listing_count),
      medianPricePerSqm:
        row.median_price_per_sqm !== null ? Number(row.median_price_per_sqm) : null,
    }));
  },
};
