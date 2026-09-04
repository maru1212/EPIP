/**
 * Integration tests for the Task 6 listing domain layer, against a real
 * PostgreSQL + PostGIS database. Like every other integration test in
 * this suite, this goes through the `pg` driver directly rather than
 * Prisma Client — a schema-specific Prisma Client cannot be generated in
 * this environment (see prisma/README.md). The SQL used mirrors
 * `listingRepository.ts` exactly, so this proves that SQL is correct
 * against a live database, independent of whether Prisma Client is
 * available.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping listing repository integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping listing repository integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

const BOLE = { longitude: 38.7969, latitude: 8.9979 };
const KAZANCHIS = { longitude: 38.7636, latitude: 9.018 };

interface Fixtures {
  locationId: string;
  propertyTypeId: string;
  agentId: string;
}

async function createFixtures(pgClient: Client): Promise<Fixtures> {
  const suffix = randomUUID();
  const location = await pgClient.query<{ id: string }>(
    `INSERT INTO location_nodes (level, name, slug, updated_at)
     VALUES ('subcity', 'T6 Test', $1, now()) RETURNING id`,
    [`t6-loc-${suffix}`]
  );
  const propertyType = await pgClient.query<{ id: string }>(
    `INSERT INTO property_types (key, label) VALUES ($1, 'T6 Type') RETURNING id`,
    [`t6-type-${suffix}`]
  );
  const agent = await pgClient.query<{ id: string }>(
    `INSERT INTO users (email, full_name, status, updated_at)
     VALUES ($1, 'T6 Agent', 'active', now()) RETURNING id`,
    [`t6-agent-${suffix}@example.com`]
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
  buildingAreaSqm?: number | null;
  landAreaSqm?: number | null;
  publicationStatus?: "draft" | "published" | "archived";
}

async function createProperty(pgClient: Client, params: CreatePropertyParams): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO properties (
       location_node_id, property_type_id, coordinates,
       bedrooms, building_area_sqm, land_area_sqm, publication_status, updated_at
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
      params.buildingAreaSqm ?? null,
      params.landAreaSqm ?? null,
      params.publicationStatus ?? "published",
    ]
  );
  return result.rows[0]!.id;
}

interface CreateListingParams {
  propertyId: string;
  agentId: string;
  listingType?: "sale" | "rent";
  price: number;
  status?: string;
  currency?: string;
}

/** Mirrors listingRepository.create() exactly. */
async function createListing(pgClient: Client, params: CreateListingParams): Promise<string> {
  const result = await pgClient.query<{ id: string }>(
    `INSERT INTO listings (property_id, agent_user_id, listing_type, price, currency, status, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::"ListingType", $4, $5, $6::"ListingStatus", now())
     RETURNING id`,
    [
      params.propertyId,
      params.agentId,
      params.listingType ?? "sale",
      params.price,
      params.currency ?? "ETB",
      params.status ?? "draft",
    ]
  );
  return result.rows[0]!.id;
}

describe.skipIf(!databaseAvailable)("Listing repository (Task 6)", () => {
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

  describe("CRUD and constraints", () => {
    it("creates a listing with defaults (currency ETB, status draft)", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);
      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(propertyId);

      const listingId = await createListing(client!, {
        propertyId,
        agentId: fixtures.agentId,
        price: 3_000_000,
      });
      createdListingIds.push(listingId);

      const result = await client!.query(
        `SELECT currency, status, negotiable, listing_type FROM listings WHERE id = $1`,
        [listingId]
      );
      expect(result.rows[0].currency).toBe("ETB");
      expect(result.rows[0].status).toBe("draft");
      expect(result.rows[0].negotiable).toBe(false);
      expect(result.rows[0].listing_type).toBe("sale");
    });

    it("rejects a zero or negative price at the database level (CHECK constraint)", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);
      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(propertyId);

      await expect(
        client!.query(
          `INSERT INTO listings (property_id, agent_user_id, listing_type, price, updated_at)
           VALUES ($1::uuid, $2::uuid, 'sale'::"ListingType", 0, now())`,
          [propertyId, fixtures.agentId]
        )
      ).rejects.toThrow(/listings_price_positive/);
    });

    it("updates only the provided fields (partial update), preserving JSONB contactInfo separately", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);
      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(propertyId);
      const listingId = await createListing(client!, {
        propertyId,
        agentId: fixtures.agentId,
        price: 1_000_000,
      });
      createdListingIds.push(listingId);

      await client!.query(
        `UPDATE listings SET price = $1, contact_info = $2::jsonb, updated_at = now() WHERE id = $3`,
        [1_200_000, JSON.stringify({ phone: "+251911000000" }), listingId]
      );

      const result = await client!.query(
        `SELECT price, negotiable, contact_info FROM listings WHERE id = $1`,
        [listingId]
      );
      expect(Number(result.rows[0].price)).toBe(1_200_000);
      expect(result.rows[0].negotiable).toBe(false); // untouched
      expect(result.rows[0].contact_info).toEqual({ phone: "+251911000000" });
    });

    it("transitions status draft -> active -> sold", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);
      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(propertyId);
      const listingId = await createListing(client!, {
        propertyId,
        agentId: fixtures.agentId,
        price: 2_000_000,
      });
      createdListingIds.push(listingId);

      for (const status of ["active", "sold"]) {
        await client!.query(
          `UPDATE listings SET status = $1::"ListingStatus", updated_at = now() WHERE id = $2`,
          [status, listingId]
        );
        const result = await client!.query(`SELECT status FROM listings WHERE id = $1`, [
          listingId,
        ]);
        expect(result.rows[0].status).toBe(status);
      }
    });
  });

  describe("combined price-range + spatial search (ACCEPTANCE CRITERION)", () => {
    it("finds an active listing matching BOTH price range AND proximity to Bole", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const bolePropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: BOLE.longitude,
        latitude: BOLE.latitude,
      });
      const kazanchisPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        longitude: KAZANCHIS.longitude,
        latitude: KAZANCHIS.latitude,
      });
      createdPropertyIds.push(bolePropertyId, kazanchisPropertyId);

      const matchingListing = await createListing(client!, {
        propertyId: bolePropertyId,
        agentId: fixtures.agentId,
        price: 5_000_000,
        status: "active",
      });
      const wrongPriceListing = await createListing(client!, {
        propertyId: bolePropertyId,
        agentId: fixtures.agentId,
        price: 50_000_000,
        status: "active",
      });
      const wrongLocationListing = await createListing(client!, {
        propertyId: kazanchisPropertyId,
        agentId: fixtures.agentId,
        price: 5_500_000,
        status: "active",
      });
      createdListingIds.push(matchingListing, wrongPriceListing, wrongLocationListing);

      // Mirrors listingRepository.search()'s combined filter.
      const result = await client!.query<{ id: string }>(
        `SELECT l.id FROM listings l
         JOIN properties p ON p.id = l.property_id
         WHERE l.price >= $1 AND l.price <= $2
           AND l.status = 'active'::"ListingStatus"
           AND p.coordinates IS NOT NULL
           AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)`,
        [4_000_000, 6_000_000, BOLE.longitude, BOLE.latitude, 2000]
      );
      const ids = result.rows.map((r) => r.id);

      expect(ids).toContain(matchingListing);
      expect(ids).not.toContain(wrongPriceListing);
      expect(ids).not.toContain(wrongLocationListing);
    });

    it("excludes listings on unpublished properties from the public search filter", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);

      const publishedPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        publicationStatus: "published",
      });
      const draftPropertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
        publicationStatus: "draft",
      });
      createdPropertyIds.push(publishedPropertyId, draftPropertyId);

      const visibleListing = await createListing(client!, {
        propertyId: publishedPropertyId,
        agentId: fixtures.agentId,
        price: 1_000_000,
        status: "active",
      });
      const hiddenListing = await createListing(client!, {
        propertyId: draftPropertyId,
        agentId: fixtures.agentId,
        price: 1_000_000,
        status: "active",
      });
      createdListingIds.push(visibleListing, hiddenListing);

      const result = await client!.query<{ id: string }>(
        `SELECT l.id FROM listings l
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active'::"ListingStatus"
           AND p.publication_status = 'published'::"PropertyPublicationStatus"`
      );
      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(visibleListing);
      expect(ids).not.toContain(hiddenListing);
    });
  });

  describe("referential integrity", () => {
    it("restricts deleting a Property or User referenced by a listing", async () => {
      const fixtures = await createFixtures(client!);
      createdLocationIds.push(fixtures.locationId);
      createdTypeIds.push(fixtures.propertyTypeId);
      createdUserIds.push(fixtures.agentId);
      const propertyId = await createProperty(client!, {
        locationId: fixtures.locationId,
        propertyTypeId: fixtures.propertyTypeId,
      });
      createdPropertyIds.push(propertyId);
      const listingId = await createListing(client!, {
        propertyId,
        agentId: fixtures.agentId,
        price: 1_000_000,
      });
      createdListingIds.push(listingId);

      await expect(
        client!.query("DELETE FROM properties WHERE id = $1", [propertyId])
      ).rejects.toThrow();
      await expect(
        client!.query("DELETE FROM users WHERE id = $1", [fixtures.agentId])
      ).rejects.toThrow();
    });
  });
});
