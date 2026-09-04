/**
 * Integration test for Property/PropertyType and the PostGIS coordinates
 * column, against a real PostgreSQL + PostGIS database.
 *
 * Like the other integration tests, this goes through the `pg` driver
 * directly rather than Prisma Client, for the same documented reason
 * (prisma/README.md): a schema-specific Prisma Client cannot be generated
 * in every environment. The queries below are the exact SQL
 * `propertyRepository.ts` runs via `$queryRaw` — this test proves that
 * SQL is correct against a real database, independent of whether Prisma
 * Client is available.
 *
 * This is the Task 5 acceptance criterion, executed for real: insert a
 * property with coordinates, then query properties within 2km using
 * ST_DWithin — no mocked spatial behavior anywhere in this file.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping Property/PostGIS integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping Property/PostGIS integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

async function createTestLocationAndType(pgClient: Client) {
  const slug = `t5-itest-${randomUUID()}`;
  const locationResult = await pgClient.query<{ id: string }>(
    `INSERT INTO location_nodes (level, name, slug, updated_at)
     VALUES ('city', 'Test City', $1, now())
     RETURNING id`,
    [slug]
  );
  const key = `t5-itest-type-${randomUUID()}`;
  const typeResult = await pgClient.query<{ id: string }>(
    `INSERT INTO property_types (key, label) VALUES ($1, 'Test Type') RETURNING id`,
    [key]
  );
  return {
    locationNodeId: locationResult.rows[0]!.id,
    propertyTypeId: typeResult.rows[0]!.id,
  };
}

/** Mirrors propertyRepository.create() exactly. */
async function createProperty(
  pgClient: Client,
  params: {
    locationNodeId: string;
    propertyTypeId: string;
    longitude: number | null;
    latitude: number | null;
  }
): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO properties (
       location_node_id, property_type_id, coordinates, updated_at
     ) VALUES (
       $1::uuid, $2::uuid,
       CASE
         WHEN $3::float8 IS NOT NULL AND $4::float8 IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
         ELSE NULL
       END,
       now()
     )
     RETURNING id`,
    [params.locationNodeId, params.propertyTypeId, params.longitude, params.latitude]
  );
  return result.rows[0]!.id;
}

/** Mirrors propertyRepository.findWithinRadius() exactly. */
async function findWithinRadius(
  pgClient: Client,
  center: { longitude: number; latitude: number },
  radiusMeters: number
): Promise<{ id: string; distanceMeters: number }[]> {
  const result = await pgClient.query<{ id: string; distance_meters: number }>(
    `SELECT id, ST_Distance(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
     FROM properties
     WHERE coordinates IS NOT NULL
       AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY distance_meters ASC`,
    [center.longitude, center.latitude, radiusMeters]
  );
  return result.rows.map((row) => ({ id: row.id, distanceMeters: row.distance_meters }));
}

describe.skipIf(!databaseAvailable)("Property / PostGIS coordinates (Task 5)", () => {
  const createdPropertyIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdTypeIds: string[] = [];

  afterEach(async () => {
    while (createdPropertyIds.length > 0) {
      await client!.query("DELETE FROM properties WHERE id = $1", [
        createdPropertyIds.pop(),
      ]);
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

  it("inserts a property with coordinates and stores them as a real PostGIS geography point", async () => {
    const { locationNodeId, propertyTypeId } = await createTestLocationAndType(client!);
    createdLocationIds.push(locationNodeId);
    createdTypeIds.push(propertyTypeId);

    const propertyId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: 38.79,
      latitude: 9.01,
    });
    createdPropertyIds.push(propertyId);

    const result = await client!.query<{ lon: number; lat: number }>(
      `SELECT ST_X(coordinates::geometry) AS lon, ST_Y(coordinates::geometry) AS lat
       FROM properties WHERE id = $1`,
      [propertyId]
    );

    expect(result.rows[0]!.lon).toBeCloseTo(38.79, 5);
    expect(result.rows[0]!.lat).toBeCloseTo(9.01, 5);
  });

  it("allows a property with no coordinates (NULL is valid, not an error)", async () => {
    const { locationNodeId, propertyTypeId } = await createTestLocationAndType(client!);
    createdLocationIds.push(locationNodeId);
    createdTypeIds.push(propertyTypeId);

    const propertyId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: null,
      latitude: null,
    });
    createdPropertyIds.push(propertyId);

    const result = await client!.query<{ coordinates: string | null }>(
      `SELECT coordinates FROM properties WHERE id = $1`,
      [propertyId]
    );
    expect(result.rows[0]!.coordinates).toBeNull();
  });

  it("ACCEPTANCE CRITERION: finds properties within 2km via ST_DWithin, excluding one further away", async () => {
    const { locationNodeId, propertyTypeId } = await createTestLocationAndType(client!);
    createdLocationIds.push(locationNodeId);
    createdTypeIds.push(propertyTypeId);

    // Reference point, ~1.2km away, and ~5.5km away (real distances,
    // computed and asserted below — not assumed).
    const center = { longitude: 38.79, latitude: 9.01 };
    const nearId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: 38.801,
      latitude: 9.01,
    });
    const farId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: 38.84,
      latitude: 9.01,
    });
    const centerId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: center.longitude,
      latitude: center.latitude,
    });
    createdPropertyIds.push(nearId, farId, centerId);

    const results = await findWithinRadius(client!, center, 2000);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).toContain(centerId);
    expect(resultIds).toContain(nearId);
    expect(resultIds).not.toContain(farId);

    // Nearest-first ordering.
    expect(results[0]!.id).toBe(centerId);
    expect(results[0]!.distanceMeters).toBeCloseTo(0, 0);
    expect(results[1]!.id).toBe(nearId);
    expect(results[1]!.distanceMeters).toBeGreaterThan(1000);
    expect(results[1]!.distanceMeters).toBeLessThan(1500);
  });

  it("uses the GIST spatial index for the ST_DWithin query when a scan is actually needed", async () => {
    // The planner correctly prefers a sequential scan over the index when
    // the table has very few rows (as it does here — every test in this
    // suite cleans up its own fixtures, so `properties` is often near-
    // empty) — that's optimal, not evidence the index is missing. What
    // this test actually wants to prove is "the index exists and is
    // usable for this query shape," independent of current table size/
    // statistics, so it forces the planner to avoid a sequential scan
    // rather than asserting what it would choose unprompted.
    // SET LOCAL only scopes to a transaction block; this isn't wrapped in
    // one, so a plain SET is used instead, with an explicit reset in
    // `finally` to avoid leaking this setting to other tests sharing the
    // same connection.
    await client!.query("SET enable_seqscan = off");
    try {
      const result = await client!.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT * FROM properties
         WHERE ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint(38.79, 9.01), 4326)::geography, 2000)`
      );
      const plan = result.rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("properties_coordinates_gist_idx");
    } finally {
      await client!.query("SET enable_seqscan = on");
    }
  });

  it("prevents deleting a PropertyType still referenced by a Property (RESTRICT)", async () => {
    const { locationNodeId, propertyTypeId } = await createTestLocationAndType(client!);
    createdLocationIds.push(locationNodeId);
    createdTypeIds.push(propertyTypeId);

    const propertyId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: 38.79,
      latitude: 9.01,
    });
    createdPropertyIds.push(propertyId);

    await expect(
      client!.query("DELETE FROM property_types WHERE id = $1", [propertyTypeId])
    ).rejects.toThrow();
  });

  it("prevents deleting a LocationNode still referenced by a Property (RESTRICT)", async () => {
    const { locationNodeId, propertyTypeId } = await createTestLocationAndType(client!);
    createdLocationIds.push(locationNodeId);
    createdTypeIds.push(propertyTypeId);

    const propertyId = await createProperty(client!, {
      locationNodeId,
      propertyTypeId,
      longitude: 38.79,
      latitude: 9.01,
    });
    createdPropertyIds.push(propertyId);

    await expect(
      client!.query("DELETE FROM location_nodes WHERE id = $1", [locationNodeId])
    ).rejects.toThrow();
  });
});
