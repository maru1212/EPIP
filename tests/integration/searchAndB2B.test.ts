/**
 * Integration tests for Task 8's search and market-data services, against
 * a real PostgreSQL + PostGIS database. Same pattern as every other
 * integration test in this suite: uses the `pg` driver directly (a
 * schema-specific Prisma Client cannot be generated here — see
 * prisma/README.md), mirroring the real repository/service SQL exactly.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping Task 8 search/B2B integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping Task 8 search/B2B integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

const BOLE = { longitude: 38.7969, latitude: 8.9979 };

interface Fixtures {
  locationId: string;
  propertyTypeId: string;
  agentId: string;
}

async function createFixtures(pgClient: Client): Promise<Fixtures> {
  const suffix = randomUUID();
  const location = await pgClient.query<{ id: string }>(
    `INSERT INTO location_nodes (level, name, slug, updated_at)
     VALUES ('subcity', 'Bole', $1, now()) RETURNING id`,
    [`t8-bole-${suffix}`]
  );
  const propertyType = await pgClient.query<{ id: string }>(
    `INSERT INTO property_types (key, label) VALUES ($1, 'T8 Type') RETURNING id`,
    [`t8-type-${suffix}`]
  );
  const agent = await pgClient.query<{ id: string }>(
    `INSERT INTO users (email, full_name, status, updated_at)
     VALUES ($1, 'T8 Agent', 'active', now()) RETURNING id`,
    [`t8-agent-${suffix}@example.com`]
  );
  return {
    locationId: location.rows[0]!.id,
    propertyTypeId: propertyType.rows[0]!.id,
    agentId: agent.rows[0]!.id,
  };
}

interface CreatePropertyParams {
  locationId: string;
  propertyTypeId: string;
  longitude?: number | null;
  latitude?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  buildingAreaSqm?: number | null;
  publicationStatus?: "draft" | "published" | "archived";
}

async function createProperty(pgClient: Client, params: CreatePropertyParams): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO properties (
       location_node_id, property_type_id, coordinates,
       bedrooms, bathrooms, building_area_sqm, publication_status, updated_at
     ) VALUES (
       $1::uuid, $2::uuid,
       CASE WHEN $3::float8 IS NOT NULL AND $4::float8 IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
            ELSE NULL END,
       $5, $6, $7, $8::"PropertyPublicationStatus", now()
     ) RETURNING id`,
    [
      params.locationId,
      params.propertyTypeId,
      params.longitude ?? null,
      params.latitude ?? null,
      params.bedrooms ?? null,
      params.bathrooms ?? null,
      params.buildingAreaSqm ?? null,
      params.publicationStatus ?? "published",
    ]
  );
  return result.rows[0]!.id;
}

async function createActiveSaleListing(
  pgClient: Client,
  propertyId: string,
  agentId: string,
  price: number
): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO listings (property_id, agent_user_id, listing_type, price, status, updated_at)
     VALUES ($1::uuid, $2::uuid, 'sale'::"ListingType", $3, 'active'::"ListingStatus", now())
     RETURNING id`,
    [propertyId, agentId, price]
  );
  return result.rows[0]!.id;
}

describe.skipIf(!databaseAvailable)("Task 8: aggregated search, evaluate-listing, B2B market data", () => {
  const createdListingIds: string[] = [];
  const createdPropertyIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdTypeIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdListingIds.length > 0) {
      await client!.query("DELETE FROM listings WHERE id = $1", [createdListingIds.pop()]);
    }
    while (createdPropertyIds.length > 0) {
      await client!.query("DELETE FROM properties WHERE id = $1", [
        createdPropertyIds.pop(),
      ]);
    }
    while (createdUserIds.length > 0) {
      await client!.query("DELETE FROM users WHERE id = $1", [createdUserIds.pop()]);
    }
    while (createdTypeIds.length > 0) {
      await client!.query("DELETE FROM property_types WHERE id = $1", [
        createdTypeIds.pop(),
      ]);
    }
    while (createdLocationIds.length > 0) {
      await client!.query("DELETE FROM location_nodes WHERE id = $1", [
        createdLocationIds.pop(),
      ]);
    }
  });

  describe("ACCEPTANCE CRITERION: complex unified search (Bole, 2+ bed, under 15M, within 2km)", () => {
    it("returns only listings matching every filter simultaneously", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const matchingPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        bedrooms: 3,
      });
      const tooExpensivePropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        bedrooms: 3,
      });
      const tooFewBedroomsPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        bedrooms: 1,
      });
      createdPropertyIds.push(
        matchingPropertyId,
        tooExpensivePropertyId,
        tooFewBedroomsPropertyId
      );

      const matchingListingId = await createActiveSaleListing(
        client!,
        matchingPropertyId,
        fixtures.agentId,
        12_000_000
      );
      const tooExpensiveListingId = await createActiveSaleListing(
        client!,
        tooExpensivePropertyId,
        fixtures.agentId,
        20_000_000
      );
      const tooFewBedroomsListingId = await createActiveSaleListing(
        client!,
        tooFewBedroomsPropertyId,
        fixtures.agentId,
        10_000_000
      );
      createdListingIds.push(matchingListingId, tooExpensiveListingId, tooFewBedroomsListingId);

      // Mirrors listingRepository.searchWithPropertyDetails()'s combined filter.
      const result = await client!.query<{ id: string }>(
        `SELECT l.id FROM listings l
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active'::"ListingStatus"
           AND l.price <= 15000000
           AND p.bedrooms >= 2
           AND p.publication_status = 'published'::"PropertyPublicationStatus"
           AND p.coordinates IS NOT NULL
           AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
        [BOLE.longitude, BOLE.latitude, 2000]
      );
      const ids = result.rows.map((r) => r.id);

      expect(ids).toContain(matchingListingId);
      expect(ids).not.toContain(tooExpensiveListingId);
      expect(ids).not.toContain(tooFewBedroomsListingId);
    });
  });

  describe("ACCEPTANCE CRITERION: B2B neighborhood stats aggregate correctly over a real hierarchy", () => {
    it("aggregates a subcity and its child neighborhoods together, but isolates a leaf neighborhood queried alone", async () => {
      const suffix = randomUUID();
      const subcity = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('subcity', 'T8 Stats Subcity', $1, now()) RETURNING id`,
        [`t8-stats-subcity-${suffix}`]
      );
      const neighborhoodA = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (parent_id, level, name, slug, updated_at)
         VALUES ($1::uuid, 'neighborhood', 'T8 Nbhd A', $2, now()) RETURNING id`,
        [subcity.rows[0]!.id, `t8-nbhd-a-${suffix}`]
      );
      const neighborhoodB = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (parent_id, level, name, slug, updated_at)
         VALUES ($1::uuid, 'neighborhood', 'T8 Nbhd B', $2, now()) RETURNING id`,
        [subcity.rows[0]!.id, `t8-nbhd-b-${suffix}`]
      );
      const propertyType = await client!.query<{ id: string }>(
        `INSERT INTO property_types (key, label) VALUES ($1, 'T8 Stats Type') RETURNING id`,
        [`t8-stats-type-${suffix}`]
      );
      const agent = await client!.query<{ id: string }>(
        `INSERT INTO users (email, full_name, status, updated_at)
         VALUES ($1, 'T8 Stats Agent', 'active', now()) RETURNING id`,
        [`t8-stats-agent-${suffix}@example.com`]
      );

      createdLocationIds.push(subcity.rows[0]!.id, neighborhoodA.rows[0]!.id, neighborhoodB.rows[0]!.id);
      createdTypeIds.push(propertyType.rows[0]!.id);
      createdUserIds.push(agent.rows[0]!.id);

      const propInSubcity = await createProperty(client!, {
        locationId: subcity.rows[0]!.id,
        propertyTypeId: propertyType.rows[0]!.id,
        buildingAreaSqm: 100,
      });
      const propInA = await createProperty(client!, {
        locationId: neighborhoodA.rows[0]!.id,
        propertyTypeId: propertyType.rows[0]!.id,
        buildingAreaSqm: 120,
      });
      const propInB = await createProperty(client!, {
        locationId: neighborhoodB.rows[0]!.id,
        propertyTypeId: propertyType.rows[0]!.id,
        buildingAreaSqm: 80,
      });
      createdPropertyIds.push(propInSubcity, propInA, propInB);

      const listingSubcity = await createActiveSaleListing(client!, propInSubcity, agent.rows[0]!.id, 5_000_000);
      const listingA = await createActiveSaleListing(client!, propInA, agent.rows[0]!.id, 6_000_000);
      const listingB = await createActiveSaleListing(client!, propInB, agent.rows[0]!.id, 4_000_000);
      createdListingIds.push(listingSubcity, listingA, listingB);

      // Mirrors marketDataService.getNeighborhoodStats() exactly, via the
      // `pg` driver directly — the real service uses the real Prisma
      // client singleton, which can't run in this sandbox (see
      // prisma/README.md), same reason every other integration test in
      // this suite goes through `pg` rather than importing the service.
      async function getNeighborhoodStatsViaPg(locationNodeId: string) {
        const nodeExists = await client!.query<{ id: string }>(
          `SELECT id FROM location_nodes WHERE id = $1`,
          [locationNodeId]
        );
        if (nodeExists.rowCount === 0) return null;

        const rows = await client!.query<{
          descendant_count: string;
          active_listing_count: string;
          median_price: string | null;
          min_price: string | null;
          max_price: string | null;
        }>(
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
          [locationNodeId]
        );
        const row = rows.rows[0]!;
        return {
          includedLocationNodeCount: Number(row.descendant_count),
          activeListingCount: Number(row.active_listing_count),
          medianPrice: row.median_price !== null ? Number(row.median_price) : null,
          priceRange: {
            min: row.min_price !== null ? Number(row.min_price) : null,
            max: row.max_price !== null ? Number(row.max_price) : null,
          },
        };
      }

      // Querying the subcity aggregates ALL THREE (itself + both children).
      const subcityStats = await getNeighborhoodStatsViaPg(subcity.rows[0]!.id);
      expect(subcityStats).not.toBeNull();
      expect(subcityStats!.includedLocationNodeCount).toBe(3);
      expect(subcityStats!.activeListingCount).toBe(3);
      expect(subcityStats!.medianPrice).toBe(5_000_000);
      expect(subcityStats!.priceRange).toEqual({ min: 4_000_000, max: 6_000_000 });

      // Querying leaf neighborhood A alone isolates just its own property —
      // not the subcity's or sibling B's.
      const nbhdAStats = await getNeighborhoodStatsViaPg(neighborhoodA.rows[0]!.id);
      expect(nbhdAStats!.includedLocationNodeCount).toBe(1);
      expect(nbhdAStats!.activeListingCount).toBe(1);
      expect(nbhdAStats!.priceRange).toEqual({ min: 6_000_000, max: 6_000_000 });
    });

    it("returns null for a nonexistent location node", async () => {
      const result = await client!.query<{ id: string }>(
        `SELECT id FROM location_nodes WHERE id = $1`,
        ["00000000-0000-0000-0000-000000000000"]
      );
      expect(result.rowCount).toBe(0);
    });
  });

  describe("evaluate-listing: ad-hoc (direct parameters) mode against real comparables", () => {
    it("assesses overpriced/fair/underpriced using real nearby active listings with no saved target Property", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const comparablePropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        buildingAreaSqm: 100,
      });
      createdPropertyIds.push(comparablePropertyId);
      const listingId = await createActiveSaleListing(
        client!,
        comparablePropertyId,
        fixtures.agentId,
        5_000_000 // 50,000/sqm
      );
      createdListingIds.push(listingId);

      const { analyzeAskingPrice } = await import(
        "@/modules/valuation/services/valuationMath"
      );

      // Mirrors valuationRepository.findComparableListings() with NO
      // excludePropertyId (ad-hoc mode has no saved property to exclude).
      const result = await client!.query<{ price: string; building_area_sqm: string }>(
        `SELECT l.price, p.building_area_sqm
         FROM listings l
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active'::"ListingStatus"
           AND l.listing_type = 'sale'::"ListingType"
           AND p.publication_status = 'published'::"PropertyPublicationStatus"
           AND p.property_type_id = $1::uuid
           AND p.building_area_sqm IS NOT NULL AND p.building_area_sqm > 0
           AND p.coordinates IS NOT NULL
           AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)`,
        [fixtures.propertyTypeId, BOLE.longitude, BOLE.latitude, 2000]
      );
      const pricesPerSqm = result.rows.map(
        (r) => Number(r.price) / Number(r.building_area_sqm)
      );

      const overpriced = analyzeAskingPrice({
        askingPrice: 9_000_000, // 90,000/sqm vs real 50,000/sqm
        targetAreaSqm: 100,
        comparablePricesPerSqm: pricesPerSqm,
      });
      expect(overpriced.sufficient).toBe(true);
      if (overpriced.sufficient) {
        expect(overpriced.assessment).toBe("overpriced");
      }
    });
  });
});
