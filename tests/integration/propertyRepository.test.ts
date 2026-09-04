/**
 * Integration tests for the Task 5 property domain layer, against a real
 * PostgreSQL + PostGIS database. Like every other integration test in
 * this suite, this goes through the `pg` driver directly rather than
 * Prisma Client — a schema-specific Prisma Client cannot be generated in
 * this environment (see prisma/README.md). The SQL used by each helper
 * below mirrors `propertyRepository.ts` exactly, so this proves that SQL
 * is correct against a live database, independent of whether Prisma
 * Client is available.
 *
 * Uses approximate real coordinates for Bole and Kazanchis, two named
 * areas in Addis Ababa, per the Task 5 spec's explicit example.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping property repository integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping property repository integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

// Approximate real-world coordinates.
const BOLE = { longitude: 38.7969, latitude: 8.9979 };
const KAZANCHIS = { longitude: 38.7636, latitude: 9.018 };

interface Fixtures {
  boleLocationId: string;
  kazanchisLocationId: string;
  propertyTypeId: string;
  ownerId: string;
}

async function createFixtures(pgClient: Client): Promise<Fixtures> {
  const suffix = randomUUID();
  const boleLocation = await pgClient.query<{ id: string }>(
    `INSERT INTO location_nodes (level, name, slug, updated_at)
     VALUES ('subcity', 'Bole', $1, now()) RETURNING id`,
    [`t5-bole-${suffix}`]
  );
  const kazanchisLocation = await pgClient.query<{ id: string }>(
    `INSERT INTO location_nodes (level, name, slug, updated_at)
     VALUES ('subcity', 'Kazanchis', $1, now()) RETURNING id`,
    [`t5-kazanchis-${suffix}`]
  );
  const propertyType = await pgClient.query<{ id: string }>(
    `INSERT INTO property_types (key, label) VALUES ($1, 'T5 Test Type') RETURNING id`,
    [`t5-type-${suffix}`]
  );
  const owner = await pgClient.query<{ id: string }>(
    `INSERT INTO users (email, full_name, status, updated_at)
     VALUES ($1, 'T5 Owner', 'active', now()) RETURNING id`,
    [`t5-owner-${suffix}@example.com`]
  );

  return {
    boleLocationId: boleLocation.rows[0]!.id,
    kazanchisLocationId: kazanchisLocation.rows[0]!.id,
    propertyTypeId: propertyType.rows[0]!.id,
    ownerId: owner.rows[0]!.id,
  };
}

interface CreatePropertyParams {
  locationNodeId: string;
  propertyTypeId: string;
  ownerUserId?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  bedrooms?: number | null;
  landAreaSqm?: number | null;
  buildingAreaSqm?: number | null;
  publicationStatus?: "draft" | "published" | "archived";
}

/** Mirrors propertyRepository.create() exactly. */
async function createProperty(pgClient: Client, params: CreatePropertyParams): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO properties (
       location_node_id, property_type_id, owner_user_id, coordinates,
       land_area_sqm, building_area_sqm, bedrooms, publication_status, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       CASE WHEN $4::float8 IS NOT NULL AND $5::float8 IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326)::geography
            ELSE NULL END,
       $6, $7, $8, $9::"PropertyPublicationStatus", now()
     ) RETURNING id`,
    [
      params.locationNodeId,
      params.propertyTypeId,
      params.ownerUserId ?? null,
      params.longitude ?? null,
      params.latitude ?? null,
      params.landAreaSqm ?? null,
      params.buildingAreaSqm ?? null,
      params.bedrooms ?? null,
      params.publicationStatus ?? "draft",
    ]
  );
  return result.rows[0]!.id;
}

describe.skipIf(!databaseAvailable)("Property repository (Task 5)", () => {
  const createdPropertyIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdTypeIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
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

  describe("CRUD", () => {
    it("creates a property with owner, coordinates, and default draft status", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.ownerId);

      const id = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        ownerUserId: fixtures.ownerId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        bedrooms: 3,
      });
      createdPropertyIds.push(id);

      const result = await client!.query(
        `SELECT owner_user_id, publication_status, bedrooms,
                ST_X(coordinates::geometry) AS lon, ST_Y(coordinates::geometry) AS lat
         FROM properties WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      expect(row.owner_user_id).toBe(fixtures.ownerId);
      expect(row.publication_status).toBe("draft");
      expect(row.bedrooms).toBe(3);
      expect(row.lon).toBeCloseTo(BOLE.longitude, 5);
      expect(row.lat).toBeCloseTo(BOLE.latitude, 5);
    });

    it("updates details via a partial SET clause (only provided columns change)", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.ownerId);

      const id = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        bedrooms: 2,
        landAreaSqm: 100,
      });
      createdPropertyIds.push(id);

      // Mirrors propertyRepository.updateDetails() with a two-field patch.
      await client!.query(
        `UPDATE properties SET bedrooms = $1, building_area_sqm = $2, updated_at = now()
         WHERE id = $3`,
        [5, 80.5, id]
      );

      const result = await client!.query(
        `SELECT bedrooms, land_area_sqm, building_area_sqm FROM properties WHERE id = $1`,
        [id]
      );
      // Changed
      expect(result.rows[0].bedrooms).toBe(5);
      expect(Number(result.rows[0].building_area_sqm)).toBe(80.5);
      // Untouched — proves this is a genuine partial update, not a
      // full-row overwrite.
      expect(Number(result.rows[0].land_area_sqm)).toBe(100);
    });

    it("updates coordinates independently of other fields", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const id = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
      });
      createdPropertyIds.push(id);

      await client!.query(
        `UPDATE properties SET
           coordinates = ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
           updated_at = now()
         WHERE id = $3`,
        [KAZANCHIS.longitude, KAZANCHIS.latitude, id]
      );

      const result = await client!.query(
        `SELECT ST_X(coordinates::geometry) AS lon, ST_Y(coordinates::geometry) AS lat
         FROM properties WHERE id = $1`,
        [id]
      );
      expect(result.rows[0].lon).toBeCloseTo(KAZANCHIS.longitude, 5);
      expect(result.rows[0].lat).toBeCloseTo(KAZANCHIS.latitude, 5);
    });

    it("transitions publication status draft -> published -> archived", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const id = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(id);

      for (const status of ["published", "archived"] as const) {
        await client!.query(
          `UPDATE properties SET publication_status = $1::"PropertyPublicationStatus", updated_at = now()
           WHERE id = $2`,
          [status, id]
        );
        const result = await client!.query(
          `SELECT publication_status FROM properties WHERE id = $1`,
          [id]
        );
        expect(result.rows[0].publication_status).toBe(status);
      }
    });
  });

  describe("spatial proximity search in Addis Ababa (ACCEPTANCE CRITERION)", () => {
    it("finds a Bole property when searching near Bole, excludes Kazanchis at a tight radius", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const boleId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        publicationStatus: "published",
      });
      const kazanchisId = await createProperty(client!, {
        locationNodeId: fixtures.kazanchisLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: KAZANCHIS.longitude,
        latitude: KAZANCHIS.latitude,
        publicationStatus: "published",
      });
      createdPropertyIds.push(boleId, kazanchisId);

      // Confirm the real distance between the two areas first, rather
      // than assuming it.
      const distanceResult = await client!.query<{ distance_meters: number }>(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
         ) AS distance_meters`,
        [BOLE.longitude, BOLE.latitude, KAZANCHIS.longitude, KAZANCHIS.latitude]
      );
      const boleToKazanchisMeters = distanceResult.rows[0]!.distance_meters;
      expect(boleToKazanchisMeters).toBeGreaterThan(3000); // sanity: genuinely separate areas

      // Mirrors propertyRepository.search()'s `near` filter, radius
      // smaller than the real Bole-Kazanchis distance.
      const tightRadius = Math.floor(boleToKazanchisMeters / 2);
      const nearBole = await client!.query<{ id: string }>(
        `SELECT id FROM properties
         WHERE coordinates IS NOT NULL
           AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           AND publication_status = 'published'::"PropertyPublicationStatus"`,
        [BOLE.longitude, BOLE.latitude, tightRadius]
      );
      const nearBoleIds = nearBole.rows.map((r) => r.id);

      expect(nearBoleIds).toContain(boleId);
      expect(nearBoleIds).not.toContain(kazanchisId);
    });

    it("finds both areas when the radius is wide enough to span them", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const boleId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        publicationStatus: "published",
      });
      const kazanchisId = await createProperty(client!, {
        locationNodeId: fixtures.kazanchisLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: KAZANCHIS.longitude,
        latitude: KAZANCHIS.latitude,
        publicationStatus: "published",
      });
      createdPropertyIds.push(boleId, kazanchisId);

      const wideRadius = 15_000; // 15km — comfortably spans central Addis Ababa
      const result = await client!.query<{ id: string; distance_meters: number }>(
        `SELECT id, ST_Distance(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
         FROM properties
         WHERE coordinates IS NOT NULL
           AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY distance_meters ASC`,
        [BOLE.longitude, BOLE.latitude, wideRadius]
      );

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(boleId);
      expect(ids).toContain(kazanchisId);
      // Nearest-first: Bole (distance 0 from itself) before Kazanchis.
      expect(ids[0]).toBe(boleId);
    });

    it("excludes draft properties from a published-only proximity search", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const publishedId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        publicationStatus: "published",
      });
      const draftId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
        publicationStatus: "draft",
      });
      createdPropertyIds.push(publishedId, draftId);

      const result = await client!.query<{ id: string }>(
        `SELECT id FROM properties
         WHERE coordinates IS NOT NULL
           AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           AND publication_status = 'published'::"PropertyPublicationStatus"`,
        [BOLE.longitude, BOLE.latitude, 1000]
      );
      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(publishedId);
      expect(ids).not.toContain(draftId);
    });
  });

  describe("filtering", () => {
    it("filters by property type and location together", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const otherType = await client!.query<{ id: string }>(
        `INSERT INTO property_types (key, label) VALUES ($1, 'Other Type') RETURNING id`,
        [`t5-other-type-${randomUUID()}`]
      );
      createdTypeIds.push(otherType.rows[0]!.id);

      const matchingId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        publicationStatus: "published",
      });
      const wrongLocationId = await createProperty(client!, {
        locationNodeId: fixtures.kazanchisLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        publicationStatus: "published",
      });
      const wrongTypeId = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: otherType.rows[0]!.id,
        publicationStatus: "published",
      });
      createdPropertyIds.push(matchingId, wrongLocationId, wrongTypeId);

      const result = await client!.query<{ id: string }>(
        `SELECT id FROM properties
         WHERE location_node_id = $1 AND property_type_id = $2
           AND publication_status = 'published'::"PropertyPublicationStatus"`,
        [fixtures.boleLocationId, fixtures.propertyTypeId]
      );
      const ids = result.rows.map((r) => r.id);
      expect(ids).toEqual([matchingId]);
    });

    it("filters by bedroom and size ranges", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);

      const small = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        bedrooms: 1,
        buildingAreaSqm: 40,
        publicationStatus: "published",
      });
      const medium = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        bedrooms: 3,
        buildingAreaSqm: 120,
        publicationStatus: "published",
      });
      const large = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        bedrooms: 6,
        buildingAreaSqm: 400,
        publicationStatus: "published",
      });
      createdPropertyIds.push(small, medium, large);

      const result = await client!.query<{ id: string }>(
        `SELECT id FROM properties
         WHERE bedrooms >= $1 AND bedrooms <= $2
           AND building_area_sqm >= $3 AND building_area_sqm <= $4
           AND publication_status = 'published'::"PropertyPublicationStatus"
           AND id = ANY($5::uuid[])`,
        [2, 5, 50, 200, [small, medium, large]]
      );
      const ids = result.rows.map((r) => r.id);
      expect(ids).toEqual([medium]);
    });
  });

  describe("referential integrity", () => {
    it("still restricts deleting a PropertyType/LocationNode/User referenced by a property with an owner", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.boleLocationId, fixtures.kazanchisLocationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.ownerId);

      const id = await createProperty(client!, {
        locationNodeId: fixtures.boleLocationId,
        propertyTypeId: fixtures.propertyTypeId,
        ownerUserId: fixtures.ownerId,
      });
      createdPropertyIds.push(id);

      await expect(
        client!.query("DELETE FROM users WHERE id = $1", [fixtures.ownerId])
      ).rejects.toThrow();
      await expect(
        client!.query("DELETE FROM property_types WHERE id = $1", [
          fixtures.propertyTypeId,
        ])
      ).rejects.toThrow();
      await expect(
        client!.query("DELETE FROM location_nodes WHERE id = $1", [
          fixtures.boleLocationId,
        ])
      ).rejects.toThrow();
    });
  });
});
