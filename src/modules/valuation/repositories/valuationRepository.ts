import { prisma } from "@/lib/db";

/**
 * Raw SQL throughout, same reasoning as listingRepository.ts: a
 * schema-specific Prisma Client cannot be generated in this environment
 * (see prisma/README.md), so ORM calls against the `any`-typed stub can't
 * be verified even by inspection, while raw SQL can be verified by
 * running the equivalent statement directly against the live database
 * (see tests/integration/valuationRepository.test.ts). Comparable
 * retrieval specifically also needs a join + optional PostGIS predicate
 * that Prisma's relational filtering can't express regardless.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ComparableListing {
  listingId: string;
  propertyId: string;
  price: number;
  buildingAreaSqm: number | null;
  landAreaSqm: number | null;
  condition: string | null;
  distanceMeters: number | null;
  /**
   * Task 12's B2B report viewer needs a human-readable address per
   * comparable. `Property.displayAddress` is optional/nullable (Task 5)
   * — many properties never have one recorded — so this is genuinely
   * `null` for a real, sizeable fraction of comparables, not a bug. The
   * UI falls back to a generic "Property near [location]" label in that
   * case rather than showing a blank cell.
   */
  displayAddress: string | null;
}

export interface FindComparablesParams {
  propertyTypeId: string;
  /**
   * Omit when there is no existing Property row to exclude (e.g. an
   * ad-hoc valuation with no saved property — see
   * valuationService.analyzeAdHoc). When provided, that property is
   * excluded from its own comparable set.
   */
  excludePropertyId?: string;
  /** Comparables sharing this LocationNode are included. */
  locationNodeId?: string;
  /** Comparables within this radius of `center` are included. */
  near?: { center: Coordinates; radiusMeters: number };
  /**
   * Which area field a comparable must have (>0) to be usable — must
   * match whichever area type the target property is being valued by
   * (see valuationService.ts). A land listing can't sensibly inform a
   * building-area-based estimate or vice versa.
   */
  areaType: "building" | "land";
  limit: number;
}

export interface CreateValuationReportInput {
  propertyId: string;
  requestedByUserId?: string | null;
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceScore: number;
  methodology?: "comparable_sales" | "cost_approach" | "hybrid";
  valuationData?: unknown;
}

export interface ValuationReportRecord {
  id: string;
  propertyId: string;
  requestedByUserId: string | null;
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceScore: number;
  methodology: string;
  status: string;
  rawAiResponse: unknown | null;
  valuationData: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValuationRepository {
  findComparableListings(params: FindComparablesParams): Promise<ComparableListing[]>;
  createReport(input: CreateValuationReportInput): Promise<ValuationReportRecord>;
  findById(id: string): Promise<ValuationReportRecord | null>;
  /**
   * The most recent report for a property, if any — uses the
   * `(property_id, created_at)` index from the Task 7 migration, whose
   * documented purpose was exactly this "historical valuation tracking"
   * access pattern.
   */
  findLatestByPropertyId(propertyId: string): Promise<ValuationReportRecord | null>;
  /**
   * Persists an AI-generated narrative onto an existing report: the raw
   * provider response (audit trail, in `rawAiResponse`) and the
   * structured narrative fields (merged into the existing
   * `valuationData` JSONB, under a `narrative` key, alongside the
   * statistical `valuationData` already written by `createReport`).
   * Never creates a new row — the statistical report this enriches
   * already exists (see aiValuationService.ts).
   */
  updateAiEnrichment(
    reportId: string,
    input: { rawAiResponse: unknown; narrative: unknown; providerName: string }
  ): Promise<ValuationReportRecord | null>;
}

async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  // Same stub-typing workaround as property/listing repositories: the
  // un-generated Prisma Client stub types PrismaClient as `any`, so an
  // explicit generic argument on `$queryRawUnsafe<T>(...)` is a
  // TypeScript error. Casting the result instead preserves the same
  // effective typing at every call site.
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

interface ComparableRow {
  listing_id: string;
  property_id: string;
  price: string;
  building_area_sqm: string | null;
  land_area_sqm: string | null;
  condition: string | null;
  distance_meters: number | null;
  display_address: string | null;
}

function toComparable(row: ComparableRow): ComparableListing {
  return {
    listingId: row.listing_id,
    propertyId: row.property_id,
    price: Number(row.price),
    buildingAreaSqm: row.building_area_sqm !== null ? Number(row.building_area_sqm) : null,
    landAreaSqm: row.land_area_sqm !== null ? Number(row.land_area_sqm) : null,
    condition: row.condition,
    distanceMeters: row.distance_meters,
    displayAddress: row.display_address,
  };
}

const REPORT_COLUMNS = `
  id, property_id, requested_by_user_id, estimated_value, low_estimate, high_estimate,
  confidence_score, methodology, status, raw_ai_response, valuation_data, created_at, updated_at
`;

interface ReportRow {
  id: string;
  property_id: string;
  requested_by_user_id: string | null;
  estimated_value: string;
  low_estimate: string;
  high_estimate: string;
  confidence_score: string;
  methodology: string;
  status: string;
  raw_ai_response: unknown | null;
  valuation_data: unknown | null;
  created_at: Date;
  updated_at: Date;
}

function toReportRecord(row: ReportRow): ValuationReportRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    requestedByUserId: row.requested_by_user_id,
    estimatedValue: Number(row.estimated_value),
    lowEstimate: Number(row.low_estimate),
    highEstimate: Number(row.high_estimate),
    confidenceScore: Number(row.confidence_score),
    methodology: row.methodology,
    status: row.status,
    rawAiResponse: row.raw_ai_response,
    valuationData: row.valuation_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const prismaValuationRepository: ValuationRepository = {
  async findComparableListings(params) {
    const areaColumn = params.areaType === "building" ? "building_area_sqm" : "land_area_sqm";

    const conditions: string[] = [
      `l.status = 'active'::"ListingStatus"`,
      `l.listing_type = 'sale'::"ListingType"`, // market VALUE means sale value — see docs/valuation-domain.md
      `p.publication_status = 'published'::"PropertyPublicationStatus"`,
      `p.property_type_id = $1::uuid`,
      `p.${areaColumn} IS NOT NULL AND p.${areaColumn} > 0`,
    ];
    const sqlParams: unknown[] = [params.propertyTypeId];

    if (params.excludePropertyId) {
      sqlParams.push(params.excludePropertyId);
      conditions.push(`p.id != $${sqlParams.length}::uuid`);
    }

    const locationOrSpatialClauses: string[] = [];
    if (params.locationNodeId) {
      sqlParams.push(params.locationNodeId);
      locationOrSpatialClauses.push(`p.location_node_id = $${sqlParams.length}::uuid`);
    }
    let distanceExpression = "NULL";
    if (params.near) {
      sqlParams.push(params.near.center.longitude, params.near.center.latitude);
      const lonIdx = sqlParams.length - 1;
      const latIdx = sqlParams.length;
      sqlParams.push(params.near.radiusMeters);
      const radiusIdx = sqlParams.length;
      locationOrSpatialClauses.push(
        `(p.coordinates IS NOT NULL AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography, $${radiusIdx}))`
      );
      distanceExpression = `ST_Distance(p.coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography)`;
    }

    if (locationOrSpatialClauses.length === 0) {
      // Neither a location nor a search center was provided — there is no
      // basis to find comparables at all.
      return [];
    }
    conditions.push(`(${locationOrSpatialClauses.join(" OR ")})`);

    sqlParams.push(params.limit);
    const limitIdx = sqlParams.length;

    const sql = `
      SELECT
        l.id AS listing_id, l.property_id, l.price,
        p.building_area_sqm, p.land_area_sqm, p.condition, p.display_address,
        ${distanceExpression} AS distance_meters
      FROM listings l
      JOIN properties p ON p.id = l.property_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY distance_meters ASC NULLS LAST, l.created_at DESC
      LIMIT $${limitIdx}
    `;

    const rows = await queryRawUnsafe<ComparableRow>(sql, ...sqlParams);
    return rows.map(toComparable);
  },

  async createReport(input) {
    const rows = await queryRawUnsafe<ReportRow>(
      `INSERT INTO valuation_reports (
        property_id, requested_by_user_id, estimated_value, low_estimate, high_estimate,
        confidence_score, methodology, valuation_data, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::"ValuationMethodology", $8::jsonb, now())
      RETURNING ${REPORT_COLUMNS}`,
      input.propertyId,
      input.requestedByUserId ?? null,
      input.estimatedValue,
      input.lowEstimate,
      input.highEstimate,
      input.confidenceScore,
      input.methodology ?? "comparable_sales",
      input.valuationData !== undefined && input.valuationData !== null
        ? JSON.stringify(input.valuationData)
        : null
    );
    return toReportRecord(rows[0]!);
  },

  async findById(id) {
    const rows = await queryRawUnsafe<ReportRow>(
      `SELECT ${REPORT_COLUMNS} FROM valuation_reports WHERE id = $1`,
      id
    );
    return rows[0] ? toReportRecord(rows[0]) : null;
  },

  async findLatestByPropertyId(propertyId) {
    const rows = await queryRawUnsafe<ReportRow>(
      `SELECT ${REPORT_COLUMNS} FROM valuation_reports
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      propertyId
    );
    return rows[0] ? toReportRecord(rows[0]) : null;
  },

  async updateAiEnrichment(reportId, input) {
    const enrichment = {
      narrative: input.narrative,
      aiProvider: input.providerName,
      aiEnrichedAt: new Date().toISOString(),
    };
    const rows = await queryRawUnsafe<ReportRow>(
      `UPDATE valuation_reports SET
         raw_ai_response = $1::jsonb,
         valuation_data = COALESCE(valuation_data, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
       WHERE id = $3
       RETURNING ${REPORT_COLUMNS}`,
      JSON.stringify(input.rawAiResponse),
      JSON.stringify(enrichment),
      reportId
    );
    return rows[0] ? toReportRecord(rows[0]) : null;
  },
};
