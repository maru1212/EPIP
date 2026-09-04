/**
 * Integration tests for Task 10's AI valuation persistence layer, against
 * a real PostgreSQL database. Same pattern as every other integration
 * test in this suite: uses the `pg` driver directly (a schema-specific
 * Prisma Client cannot be generated here — see prisma/README.md),
 * mirroring `valuationRepository.updateAiEnrichment` and
 * `aiValuationService`'s location/type lookups' exact SQL.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping AI valuation integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping AI valuation integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

/** Mirrors valuationRepository.updateAiEnrichment() exactly. */
async function updateAiEnrichment(
  pgClient: Client,
  reportId: string,
  input: { rawAiResponse: unknown; narrative: unknown; providerName: string }
) {
  const enrichment = {
    narrative: input.narrative,
    aiProvider: input.providerName,
    aiEnrichedAt: new Date().toISOString(),
  };
  const result = await pgClient.query(
    `UPDATE valuation_reports SET
       raw_ai_response = $1::jsonb,
       valuation_data = COALESCE(valuation_data, '{}'::jsonb) || $2::jsonb,
       updated_at = now()
     WHERE id = $3
     RETURNING raw_ai_response, valuation_data`,
    [JSON.stringify(input.rawAiResponse), JSON.stringify(enrichment), reportId]
  );
  return result.rows[0];
}

describe.skipIf(!databaseAvailable)("AI valuation persistence (Task 10)", () => {
  const createdReportIds: string[] = [];
  const createdPropertyIds: string[] = [];
  const createdLocationIds: string[] = [];
  const createdTypeIds: string[] = [];

  afterEach(async () => {
    while (createdReportIds.length > 0) {
      await client!.query("DELETE FROM valuation_reports WHERE id = $1", [
        createdReportIds.pop(),
      ]);
    }
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

  describe("ACCEPTANCE CRITERION: JSONB enrichment preserves existing statistical data", () => {
    it("merges narrative fields into valuationData without losing the original statistical keys", async () => {
      const suffix = randomUUID();
      const location = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('city', 'T10 City', $1, now()) RETURNING id`,
        [`t10-city-${suffix}`]
      );
      const propertyType = await client!.query<{ id: string }>(
        `INSERT INTO property_types (key, label) VALUES ($1, 'T10 Type') RETURNING id`,
        [`t10-type-${suffix}`]
      );
      createdLocationIds.push(location.rows[0]!.id);
      createdTypeIds.push(propertyType.rows[0]!.id);

      const property = await client!.query<{ id: string }>(
        `INSERT INTO properties (location_node_id, property_type_id, updated_at)
         VALUES ($1::uuid, $2::uuid, now()) RETURNING id`,
        [location.rows[0]!.id, propertyType.rows[0]!.id]
      );
      createdPropertyIds.push(property.rows[0]!.id);

      const report = await client!.query<{ id: string }>(
        `INSERT INTO valuation_reports (
           property_id, estimated_value, low_estimate, high_estimate, confidence_score,
           valuation_data, updated_at
         ) VALUES ($1::uuid, 5000000, 4500000, 5500000, 0.82, $2::jsonb, now())
         RETURNING id`,
        [
          property.rows[0]!.id,
          JSON.stringify({
            medianPricePerSqm: 50000,
            averagePricePerSqm: 50500,
            comparableCount: 6,
            coefficientOfVariation: 0.08,
            comparableListingIds: [randomUUID(), randomUUID()],
          }),
        ]
      );
      const reportId = report.rows[0]!.id;
      createdReportIds.push(reportId);

      const narrative = {
        executiveSummary: "Test executive summary.",
        locationAnalysis: "Test location analysis.",
        pricingFactors: "Test pricing factors.",
        confidenceExplanation: "Test confidence explanation.",
      };

      const updated = await updateAiEnrichment(client!, reportId, {
        rawAiResponse: { provider: "mock", output: narrative },
        narrative,
        providerName: "mock",
      });

      expect(updated.valuation_data.narrative).toEqual(narrative);
      expect(updated.valuation_data.aiProvider).toBe("mock");
      expect(updated.raw_ai_response.provider).toBe("mock");

      expect(updated.valuation_data.medianPricePerSqm).toBe(50000);
      expect(updated.valuation_data.averagePricePerSqm).toBe(50500);
      expect(updated.valuation_data.comparableCount).toBe(6);
      expect(updated.valuation_data.coefficientOfVariation).toBe(0.08);
      expect(updated.valuation_data.comparableListingIds).toHaveLength(2);

      const reread = await client!.query(
        `SELECT valuation_data, raw_ai_response FROM valuation_reports WHERE id = $1`,
        [reportId]
      );
      expect(reread.rows[0].valuation_data.narrative.executiveSummary).toBe(
        "Test executive summary."
      );
      expect(reread.rows[0].valuation_data.medianPricePerSqm).toBe(50000);
    });

    it("can be enriched more than once without losing earlier statistical data", async () => {
      const suffix = randomUUID();
      const location = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('city', 'T10 City B', $1, now()) RETURNING id`,
        [`t10-city-b-${suffix}`]
      );
      const propertyType = await client!.query<{ id: string }>(
        `INSERT INTO property_types (key, label) VALUES ($1, 'T10 Type B') RETURNING id`,
        [`t10-type-b-${suffix}`]
      );
      createdLocationIds.push(location.rows[0]!.id);
      createdTypeIds.push(propertyType.rows[0]!.id);

      const property = await client!.query<{ id: string }>(
        `INSERT INTO properties (location_node_id, property_type_id, updated_at)
         VALUES ($1::uuid, $2::uuid, now()) RETURNING id`,
        [location.rows[0]!.id, propertyType.rows[0]!.id]
      );
      createdPropertyIds.push(property.rows[0]!.id);

      const report = await client!.query<{ id: string }>(
        `INSERT INTO valuation_reports (
           property_id, estimated_value, low_estimate, high_estimate, confidence_score,
           valuation_data, updated_at
         ) VALUES ($1::uuid, 3000000, 2700000, 3300000, 0.6, $2::jsonb, now())
         RETURNING id`,
        [property.rows[0]!.id, JSON.stringify({ medianPricePerSqm: 30000 })]
      );
      const reportId = report.rows[0]!.id;
      createdReportIds.push(reportId);

      await updateAiEnrichment(client!, reportId, {
        rawAiResponse: { attempt: 1 },
        narrative: { executiveSummary: "First attempt." },
        providerName: "mock",
      });

      const second = await updateAiEnrichment(client!, reportId, {
        rawAiResponse: { attempt: 2 },
        narrative: { executiveSummary: "Second, corrected attempt." },
        providerName: "mock",
      });

      expect(second.valuation_data.narrative.executiveSummary).toBe(
        "Second, corrected attempt."
      );
      expect(second.valuation_data.medianPricePerSqm).toBe(30000);
      expect(second.raw_ai_response.attempt).toBe(2);
    });
  });

  describe("location ancestor-chain lookup (used to build AI prompt context)", () => {
    it("returns the chain most-specific-first for a real multi-level hierarchy", async () => {
      const suffix = randomUUID();
      const city = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('city', 'T10 Addis Ababa', $1, now()) RETURNING id`,
        [`t10-addis-${suffix}`]
      );
      const subcity = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (parent_id, level, name, slug, updated_at)
         VALUES ($1::uuid, 'subcity', 'T10 Bole', $2, now()) RETURNING id`,
        [city.rows[0]!.id, `t10-bole-${suffix}`]
      );
      createdLocationIds.push(city.rows[0]!.id, subcity.rows[0]!.id);

      const result = await client!.query<{ name: string }>(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id, name, 0 AS depth FROM location_nodes WHERE id = $1
           UNION ALL
           SELECT ln.id, ln.parent_id, ln.name, a.depth + 1
           FROM location_nodes ln
           JOIN ancestors a ON ln.id = a.parent_id
         )
         SELECT name FROM ancestors ORDER BY depth ASC`,
        [subcity.rows[0]!.id]
      );

      expect(result.rows.map((r) => r.name)).toEqual(["T10 Bole", "T10 Addis Ababa"]);
    });

    it("returns just the single node's name when it has no parent", async () => {
      const suffix = randomUUID();
      const city = await client!.query<{ id: string }>(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('city', 'T10 Standalone City', $1, now()) RETURNING id`,
        [`t10-standalone-${suffix}`]
      );
      createdLocationIds.push(city.rows[0]!.id);

      const result = await client!.query<{ name: string }>(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id, name, 0 AS depth FROM location_nodes WHERE id = $1
           UNION ALL
           SELECT ln.id, ln.parent_id, ln.name, a.depth + 1
           FROM location_nodes ln
           JOIN ancestors a ON ln.id = a.parent_id
         )
         SELECT name FROM ancestors ORDER BY depth ASC`,
        [city.rows[0]!.id]
      );

      expect(result.rows.map((r) => r.name)).toEqual(["T10 Standalone City"]);
    });
  });
});
