/**
 * Integration tests for the Task 7 valuation domain layer, against a real
 * PostgreSQL + PostGIS database. Like every other integration test in
 * this suite, this goes through the `pg` driver directly rather than
 * Prisma Client — a schema-specific Prisma Client cannot be generated in
 * this environment (see prisma/README.md). The SQL mirrors
 * `valuationRepository.ts` exactly; the math is the actual, real
 * `computeValuationEstimate`/`analyzeAskingPrice` functions imported
 * directly (pure functions, no database dependency — see
 * valuationMath.ts) — so this proves the full real pipeline: real SQL
 * comparable retrieval against real Bole-area data, fed into the real
 * math.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { computeValuationEstimate, analyzeAskingPrice } from "@/modules/valuation/services/valuationMath";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping valuation integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping valuation integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

// Real approximate Bole, Addis Ababa coordinates, spread across a small
// area (a few hundred meters apart) — same reference point used in the
// Task 5/6 spatial tests.
const BOLE_CENTER = { longitude: 38.7969, latitude: 8.9979 };
const BOLE_NEARBY = [
  { longitude: 38.797, latitude: 8.998 },
  { longitude: 38.7965, latitude: 8.9975 },
  { longitude: 38.7975, latitude: 8.9985 },
];
const FAR_AWAY = { longitude: 39.5, latitude: 9.5 }; // well outside any reasonable radius

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
    [`t7-bole-${suffix}`]
  );
  const propertyType = await pgClient.query<{ id: string }>(
    `INSERT INTO property_types (key, label) VALUES ($1, 'T7 Type') RETURNING id`,
    [`t7-type-${suffix}`]
  );
  const agent = await pgClient.query<{ id: string }>(
    `INSERT INTO users (email, full_name, status, updated_at)
     VALUES ($1, 'T7 Agent', 'active', now()) RETURNING id`,
    [`t7-agent-${suffix}@example.com`]
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
  buildingAreaSqm?: number | null;
  condition?: string | null;
  publicationStatus?: "draft" | "published" | "archived";
}

async function createProperty(pgClient: Client, params: CreatePropertyParams): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO properties (
       location_node_id, property_type_id, coordinates, building_area_sqm, condition,
       publication_status, updated_at
     ) VALUES (
       $1::uuid, $2::uuid,
       CASE WHEN $3::float8 IS NOT NULL AND $4::float8 IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
            ELSE NULL END,
       $5, $6, $7::"PropertyPublicationStatus", now()
     ) RETURNING id`,
    [
      params.locationId,
      params.propertyTypeId,
      params.longitude ?? null,
      params.latitude ?? null,
      params.buildingAreaSqm ?? null,
      params.condition ?? "good",
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

/** Mirrors valuationRepository.findComparableListings() for the spatial ("near") case. */
async function findComparablePricesPerSqmNear(
  pgClient: Client,
  params: { propertyTypeId: string; excludePropertyId: string; center: typeof BOLE_CENTER; radiusMeters: number }
): Promise<number[]> {
  const result = await pgClient.query<{ price: string; building_area_sqm: string }>(
    `SELECT l.price, p.building_area_sqm
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     WHERE l.status = 'active'::"ListingStatus"
       AND l.listing_type = 'sale'::"ListingType"
       AND p.publication_status = 'published'::"PropertyPublicationStatus"
       AND p.property_type_id = $1::uuid
       AND p.id != $2::uuid
       AND p.building_area_sqm IS NOT NULL AND p.building_area_sqm > 0
       AND p.coordinates IS NOT NULL
       AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)`,
    [
      params.propertyTypeId,
      params.excludePropertyId,
      params.center.longitude,
      params.center.latitude,
      params.radiusMeters,
    ]
  );
  return result.rows.map((r) => Number(r.price) / Number(r.building_area_sqm));
}

describe.skipIf(!databaseAvailable)("Valuation engine (Task 7)", () => {
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

  describe("ACCEPTANCE CRITERION: market valuation generation in Bole", () => {
    it("produces a real estimate from real comparable listings near Bole, excluding a distant one", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const targetPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE_CENTER.longitude,
        latitude: BOLE_CENTER.latitude,
        buildingAreaSqm: 100,
        condition: "good",
      });
      createdPropertyIds.push(targetPropertyId);

      // Three nearby comparables, consistent price-per-sqm (~50,000 ETB/sqm).
      const comparablePropertyIds: string[] = [];
      for (const coord of BOLE_NEARBY) {
        const propId = await createProperty(client!, {
          locationId: fixtures.locationId,
          propertyTypeId: fixtures.propertyTypeId,
          longitude: coord.longitude,
          latitude: coord.latitude,
          buildingAreaSqm: 100,
        });
        comparablePropertyIds.push(propId);
        const listingId = await createActiveSaleListing(
          client!,
          propId,
          fixtures.agentId,
          5_000_000 // 50,000/sqm
        );
        createdListingIds.push(listingId);
      }
      createdPropertyIds.push(...comparablePropertyIds);

      // A far-away comparable at a wildly different price — must be
      // excluded by the spatial filter, or it would skew the estimate.
      const farPropId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: FAR_AWAY.longitude,
        latitude: FAR_AWAY.latitude,
        buildingAreaSqm: 100,
      });
      createdPropertyIds.push(farPropId);
      const farListingId = await createActiveSaleListing(
        client!,
        farPropId,
        fixtures.agentId,
        50_000_000 // 500,000/sqm — would badly skew the estimate if included
      );
      createdListingIds.push(farListingId);

      const pricesPerSqm = await findComparablePricesPerSqmNear(client!, {
        propertyTypeId: fixtures.propertyTypeId,
        excludePropertyId: targetPropertyId,
        center: BOLE_CENTER,
        radiusMeters: 2000,
      });

      // The real, actual math function — not a reimplementation.
      const result = computeValuationEstimate({
        comparablePricesPerSqm: pricesPerSqm,
        targetAreaSqm: 100,
        condition: "good",
      });

      expect(result.sufficient).toBe(true);
      if (result.sufficient) {
        expect(result.comparableCount).toBe(3); // the far one is excluded
        expect(result.medianPricePerSqm).toBeCloseTo(50_000, 0);
        expect(result.estimatedValue).toBeCloseTo(5_000_000, -3); // within ~1000 ETB
        expect(result.confidenceScore).toBeGreaterThan(0.3); // 3 consistent comps
      }
    });
  });

  describe("dynamic confidence scaling with sample size (ACCEPTANCE CRITERION)", () => {
    it("scales confidence from 0 (no comparables) up as real comparables are added", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const targetPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE_CENTER.longitude,
        latitude: BOLE_CENTER.latitude,
        buildingAreaSqm: 100,
      });
      createdPropertyIds.push(targetPropertyId);

      // Zero comparables yet.
      const zeroComparables = await findComparablePricesPerSqmNear(client!, {
        propertyTypeId: fixtures.propertyTypeId,
        excludePropertyId: targetPropertyId,
        center: BOLE_CENTER,
        radiusMeters: 2000,
      });
      const zeroResult = computeValuationEstimate({
        comparablePricesPerSqm: zeroComparables,
        targetAreaSqm: 100,
        condition: "good",
      });
      expect(zeroResult.sufficient).toBe(false);

      // Add comparables one at a time, real inserts each time, and
      // confirm confidence is monotonically non-decreasing as real
      // consistent data accumulates.
      let previousConfidence = 0;
      for (const coord of BOLE_NEARBY) {
        const propId = await createProperty(client!, {
          locationId: fixtures.locationId,
          propertyTypeId: fixtures.propertyTypeId,
          longitude: coord.longitude,
          latitude: coord.latitude,
          buildingAreaSqm: 100,
        });
        createdPropertyIds.push(propId);
        const listingId = await createActiveSaleListing(client!, propId, fixtures.agentId, 5_000_000);
        createdListingIds.push(listingId);

        const currentComparables = await findComparablePricesPerSqmNear(client!, {
          propertyTypeId: fixtures.propertyTypeId,
          excludePropertyId: targetPropertyId,
          center: BOLE_CENTER,
          radiusMeters: 2000,
        });
        const currentResult = computeValuationEstimate({
          comparablePricesPerSqm: currentComparables,
          targetAreaSqm: 100,
          condition: "good",
        });

        expect(currentResult.sufficient).toBe(true);
        if (currentResult.sufficient) {
          expect(currentResult.confidenceScore).toBeGreaterThanOrEqual(previousConfidence);
          previousConfidence = currentResult.confidenceScore;
        }
      }
      expect(previousConfidence).toBeGreaterThan(0);
    });
  });

  describe("ACCEPTANCE CRITERION: overpriced/fair/underpriced analysis against active listings", () => {
    it("correctly assesses an asking price against real comparable listings", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const targetPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE_CENTER.longitude,
        latitude: BOLE_CENTER.latitude,
        buildingAreaSqm: 100,
      });
      createdPropertyIds.push(targetPropertyId);

      for (const coord of BOLE_NEARBY) {
        const propId = await createProperty(client!, {
          locationId: fixtures.locationId,
          propertyTypeId: fixtures.propertyTypeId,
          longitude: coord.longitude,
          latitude: coord.latitude,
          buildingAreaSqm: 100,
        });
        createdPropertyIds.push(propId);
        const listingId = await createActiveSaleListing(client!, propId, fixtures.agentId, 5_000_000);
        createdListingIds.push(listingId);
      }

      const pricesPerSqm = await findComparablePricesPerSqmNear(client!, {
        propertyTypeId: fixtures.propertyTypeId,
        excludePropertyId: targetPropertyId,
        center: BOLE_CENTER,
        radiusMeters: 2000,
      });

      const overpriced = analyzeAskingPrice({
        askingPrice: 8_000_000, // 80,000/sqm vs real ~50,000/sqm median
        targetAreaSqm: 100,
        comparablePricesPerSqm: pricesPerSqm,
      });
      expect(overpriced.sufficient).toBe(true);
      if (overpriced.sufficient) expect(overpriced.assessment).toBe("overpriced");

      const fair = analyzeAskingPrice({
        askingPrice: 5_050_000,
        targetAreaSqm: 100,
        comparablePricesPerSqm: pricesPerSqm,
      });
      expect(fair.sufficient).toBe(true);
      if (fair.sufficient) expect(fair.assessment).toBe("fairly_priced");

      const underpriced = analyzeAskingPrice({
        askingPrice: 4_000_000,
        targetAreaSqm: 100,
        comparablePricesPerSqm: pricesPerSqm,
      });
      expect(underpriced.sufficient).toBe(true);
      if (underpriced.sufficient) expect(underpriced.assessment).toBe("underpriced");
    });
  });

  describe("ValuationReport persistence and constraints", () => {
    it("persists a report satisfying every CHECK constraint, and enforces referential integrity", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        buildingAreaSqm: 100,
      });
      createdPropertyIds.push(propertyId);

      const result = await client!.query<{ id: string }>(
        `INSERT INTO valuation_reports (
           property_id, requested_by_user_id, estimated_value, low_estimate, high_estimate,
           confidence_score, valuation_data, updated_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, now())
         RETURNING id`,
        [
          propertyId,
          fixtures.agentId,
          5_000_000,
          4_500_000,
          5_500_000,
          0.72,
          JSON.stringify({ comparableListingIds: [] }),
        ]
      );
      const reportId = result.rows[0]!.id;

      // Cleanup requires deleting the report before the property, since
      // the FK is RESTRICT — confirms the constraint is real, not just
      // declared.
      await expect(
        client!.query("DELETE FROM properties WHERE id = $1", [propertyId])
      ).rejects.toThrow();

      await client!.query("DELETE FROM valuation_reports WHERE id = $1", [reportId]);
    });
  });
});
