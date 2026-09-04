import { prisma } from "@/lib/db";
import { WhereBuilder } from "@/lib/sql/whereBuilder";

/**
 * The un-generated Prisma Client stub in this environment (see
 * prisma/README.md) types `PrismaClient` as `any`, which means
 * `prisma.$queryRawUnsafe<T>(...)` — an explicit generic type argument on
 * an untyped call — is a TypeScript error ("untyped function calls may
 * not accept type arguments"), even though this is exactly how a real
 * generated client is meant to be called. This thin wrapper sidesteps
 * that by casting the result instead of parameterizing the call,
 * preserving the same effective typing at every call site below.
 */
async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

/**
 * `coordinates` is a PostGIS `geography(Point, 4326)` column, declared
 * `Unsupported` in schema.prisma because Prisma has no native geography
 * type — every operation touching it goes through `$queryRaw`/
 * `$executeRaw`/`$queryRawUnsafe` rather than the normal Prisma Client
 * API. For consistency, this repository keeps ALL Property queries in
 * raw SQL rather than mixing ORM calls for some fields and raw SQL for
 * others — one query style for the whole table is easier to reason about
 * than two.
 *
 * `$queryRawUnsafe` is used only in `search` and `updateDetails`, where
 * the set of filters/columns is genuinely dynamic. Every value is still
 * passed as a parameterized argument ($1, $2, ...), never interpolated
 * into the SQL string — only column *names* are concatenated, and those
 * come from fixed whitelists (`UPDATABLE_COLUMNS` below, and a small
 * fixed set of filter conditions in `search`), never from caller-supplied
 * strings. This is the safe, standard pattern for a dynamic query with a
 * driver/ORM that doesn't support building it any other way here (see
 * prisma/README.md on why `Prisma.sql` fragment composition isn't
 * reliably typed against the un-generated client in this environment).
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type PropertyCondition =
  | "new"
  | "excellent"
  | "good"
  | "needs_renovation"
  | "under_construction";

export type ConstructionStatus = "completed" | "under_construction" | "planned";

export type PropertyPublicationStatus = "draft" | "published" | "archived";

export interface PropertyRecord {
  id: string;
  locationNodeId: string;
  propertyTypeId: string;
  ownerUserId: string | null;
  coordinates: Coordinates | null;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  floor: number | null;
  yearBuilt: number | null;
  condition: PropertyCondition | null;
  constructionStatus: ConstructionStatus | null;
  displayAddress: string | null;
  landmark: string | null;
  addressDescription: string | null;
  publicationStatus: PropertyPublicationStatus;
  verificationStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePropertyInput {
  locationNodeId: string;
  propertyTypeId: string;
  ownerUserId?: string | null;
  coordinates?: Coordinates | null;
  landAreaSqm?: number | null;
  buildingAreaSqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parkingSpaces?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  condition?: PropertyCondition | null;
  constructionStatus?: ConstructionStatus | null;
  displayAddress?: string | null;
  landmark?: string | null;
  addressDescription?: string | null;
  publicationStatus?: PropertyPublicationStatus;
}

/**
 * All fields optional: only the keys actually present on the object are
 * updated (sparse-patch semantics — see `updateDetails`). Coordinates and
 * publication status are handled by their own dedicated update methods,
 * not this one, since they need different SQL shapes.
 */
export interface UpdatePropertyDetailsInput {
  landAreaSqm?: number | null;
  buildingAreaSqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parkingSpaces?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  condition?: PropertyCondition | null;
  constructionStatus?: ConstructionStatus | null;
  displayAddress?: string | null;
  landmark?: string | null;
  addressDescription?: string | null;
}

export interface PropertySearchFilters {
  locationNodeId?: string;
  propertyTypeId?: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  minLandAreaSqm?: number;
  maxLandAreaSqm?: number;
  minBuildingAreaSqm?: number;
  maxBuildingAreaSqm?: number;
  /** Defaults to "published" at the service layer for public search. */
  publicationStatus?: PropertyPublicationStatus;
  ownerUserId?: string;
  near?: { center: Coordinates; radiusMeters: number };
  limit: number;
  offset: number;
}

export interface PropertyWithinRadius {
  id: string;
  distanceMeters: number;
}

export interface PropertyRepository {
  create(input: CreatePropertyInput): Promise<PropertyRecord>;
  findById(id: string): Promise<PropertyRecord | null>;
  search(filters: PropertySearchFilters): Promise<PropertyRecord[]>;
  updateDetails(
    id: string,
    patch: UpdatePropertyDetailsInput
  ): Promise<PropertyRecord | null>;
  updateCoordinates(
    id: string,
    coordinates: Coordinates | null
  ): Promise<PropertyRecord | null>;
  updatePublicationStatus(
    id: string,
    status: PropertyPublicationStatus
  ): Promise<PropertyRecord | null>;
  /**
   * Properties within `radiusMeters` of the given point, nearest first,
   * regardless of publication status. Retained as a narrow, dedicated
   * method (in addition to `search`'s `near` filter) since it predates
   * `search` and existing tests exercise this exact shape; `search` is
   * the general-purpose entry point going forward.
   */
  findWithinRadius(
    center: Coordinates,
    radiusMeters: number
  ): Promise<PropertyWithinRadius[]>;
}

const PROPERTY_COLUMNS = `
  id, location_node_id, property_type_id, owner_user_id,
  ST_X(coordinates::geometry) AS longitude, ST_Y(coordinates::geometry) AS latitude,
  land_area_sqm, building_area_sqm, bedrooms, bathrooms, parking_spaces, floor, year_built,
  condition, construction_status, display_address, landmark, address_description,
  publication_status, verification_status, created_at, updated_at
`;

interface PropertyRow {
  id: string;
  location_node_id: string;
  property_type_id: string;
  owner_user_id: string | null;
  longitude: number | null;
  latitude: number | null;
  land_area_sqm: string | null;
  building_area_sqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_spaces: number | null;
  floor: number | null;
  year_built: number | null;
  condition: PropertyCondition | null;
  construction_status: ConstructionStatus | null;
  display_address: string | null;
  landmark: string | null;
  address_description: string | null;
  publication_status: PropertyPublicationStatus;
  verification_status: string;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: PropertyRow): PropertyRecord {
  return {
    id: row.id,
    locationNodeId: row.location_node_id,
    propertyTypeId: row.property_type_id,
    ownerUserId: row.owner_user_id,
    coordinates:
      row.longitude !== null && row.latitude !== null
        ? { longitude: row.longitude, latitude: row.latitude }
        : null,
    // Decimal columns come back from $queryRaw as strings (to avoid
    // silent precision loss converting to JS `number` at the driver
    // level) — converted here, at the one seam between "what the
    // database returns" and "what this module depends on".
    landAreaSqm: row.land_area_sqm !== null ? Number(row.land_area_sqm) : null,
    buildingAreaSqm:
      row.building_area_sqm !== null ? Number(row.building_area_sqm) : null,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    parkingSpaces: row.parking_spaces,
    floor: row.floor,
    yearBuilt: row.year_built,
    condition: row.condition,
    constructionStatus: row.construction_status,
    displayAddress: row.display_address,
    landmark: row.landmark,
    addressDescription: row.address_description,
    publicationStatus: row.publication_status,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Column whitelist for `updateDetails`'s dynamic SET clause. Keys are the
 * `UpdatePropertyDetailsInput` field names; values are the real column
 * names. Never derived from caller input — see file header.
 */
const UPDATABLE_COLUMNS: Record<keyof UpdatePropertyDetailsInput, string> = {
  landAreaSqm: "land_area_sqm",
  buildingAreaSqm: "building_area_sqm",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  parkingSpaces: "parking_spaces",
  floor: "floor",
  yearBuilt: "year_built",
  condition: "condition",
  constructionStatus: "construction_status",
  displayAddress: "display_address",
  landmark: "landmark",
  addressDescription: "address_description",
};

export const prismaPropertyRepository: PropertyRepository = {
  async create(input) {
    const longitude = input.coordinates?.longitude ?? null;
    const latitude = input.coordinates?.latitude ?? null;

    const rows = await queryRawUnsafe<PropertyRow>(
      `INSERT INTO properties (
        location_node_id, property_type_id, owner_user_id, coordinates,
        land_area_sqm, building_area_sqm, bedrooms, bathrooms, parking_spaces,
        floor, year_built, condition, construction_status,
        display_address, landmark, address_description,
        publication_status, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid,
        CASE WHEN $4::float8 IS NOT NULL AND $5::float8 IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326)::geography
             ELSE NULL END,
        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now()
      )
      RETURNING ${PROPERTY_COLUMNS}`,
      input.locationNodeId,
      input.propertyTypeId,
      input.ownerUserId ?? null,
      longitude,
      latitude,
      input.landAreaSqm ?? null,
      input.buildingAreaSqm ?? null,
      input.bedrooms ?? null,
      input.bathrooms ?? null,
      input.parkingSpaces ?? null,
      input.floor ?? null,
      input.yearBuilt ?? null,
      input.condition ?? null,
      input.constructionStatus ?? null,
      input.displayAddress ?? null,
      input.landmark ?? null,
      input.addressDescription ?? null,
      input.publicationStatus ?? "draft"
    );
    return toRecord(rows[0]!);
  },

  async findById(id) {
    const rows = await queryRawUnsafe<PropertyRow>(
      `SELECT ${PROPERTY_COLUMNS} FROM properties WHERE id = $1`,
      id
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async search(filters) {
    const where = new WhereBuilder();

    if (filters.locationNodeId) {
      where.add("location_node_id = ?::uuid", filters.locationNodeId);
    }
    if (filters.propertyTypeId) {
      where.add("property_type_id = ?::uuid", filters.propertyTypeId);
    }
    if (filters.ownerUserId) {
      where.add("owner_user_id = ?::uuid", filters.ownerUserId);
    }
    if (filters.publicationStatus) {
      where.add(
        'publication_status = ?::"PropertyPublicationStatus"',
        filters.publicationStatus
      );
    }
    if (filters.minBedrooms !== undefined) {
      where.add("bedrooms >= ?", filters.minBedrooms);
    }
    if (filters.maxBedrooms !== undefined) {
      where.add("bedrooms <= ?", filters.maxBedrooms);
    }
    if (filters.minLandAreaSqm !== undefined) {
      where.add("land_area_sqm >= ?", filters.minLandAreaSqm);
    }
    if (filters.maxLandAreaSqm !== undefined) {
      where.add("land_area_sqm <= ?", filters.maxLandAreaSqm);
    }
    if (filters.minBuildingAreaSqm !== undefined) {
      where.add("building_area_sqm >= ?", filters.minBuildingAreaSqm);
    }
    if (filters.maxBuildingAreaSqm !== undefined) {
      where.add("building_area_sqm <= ?", filters.maxBuildingAreaSqm);
    }

    let orderBy = "ORDER BY created_at DESC";
    if (filters.near) {
      const [lonIdx, latIdx, radiusIdx] = where.nextParamIndexes(3);
      where.pushParams(
        filters.near.center.longitude,
        filters.near.center.latitude,
        filters.near.radiusMeters
      );
      where.conditions.push(
        `coordinates IS NOT NULL AND ST_DWithin(coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography, $${radiusIdx})`
      );
      orderBy = `ORDER BY ST_Distance(coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography) ASC`;
    }

    const [limitIdx, offsetIdx] = where.nextParamIndexes(2);
    where.pushParams(filters.limit, filters.offset);

    const sql = `
      SELECT ${PROPERTY_COLUMNS} FROM properties
      ${where.toSql()}
      ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await queryRawUnsafe<PropertyRow>(sql, ...where.params);
    return rows.map(toRecord);
  },

  async updateDetails(id, patch) {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const key of Object.keys(patch) as (keyof UpdatePropertyDetailsInput)[]) {
      if (!(key in UPDATABLE_COLUMNS)) continue; // extra safety: whitelist only
      const column = UPDATABLE_COLUMNS[key];
      params.push(patch[key] ?? null);
      setClauses.push(`${column} = $${params.length}`);
    }

    if (setClauses.length === 0) {
      // Nothing to update — return the current row rather than issuing a
      // no-op UPDATE.
      return prismaPropertyRepository.findById(id);
    }

    setClauses.push(`updated_at = now()`);
    params.push(id);

    const rows = await queryRawUnsafe<PropertyRow>(
      `UPDATE properties SET ${setClauses.join(", ")} WHERE id = $${params.length}
       RETURNING ${PROPERTY_COLUMNS}`,
      ...params
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async updateCoordinates(id, coordinates) {
    const longitude = coordinates?.longitude ?? null;
    const latitude = coordinates?.latitude ?? null;

    const rows = await queryRawUnsafe<PropertyRow>(
      `UPDATE properties SET
         coordinates = CASE
           WHEN $1::float8 IS NOT NULL AND $2::float8 IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography
           ELSE NULL
         END,
         updated_at = now()
       WHERE id = $3
       RETURNING ${PROPERTY_COLUMNS}`,
      longitude,
      latitude,
      id
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async updatePublicationStatus(id, status) {
    const rows = await queryRawUnsafe<PropertyRow>(
      `UPDATE properties SET publication_status = $1::"PropertyPublicationStatus", updated_at = now()
       WHERE id = $2
       RETURNING ${PROPERTY_COLUMNS}`,
      status,
      id
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async findWithinRadius(center, radiusMeters) {
    const rows = await prisma.$queryRaw<{ id: string; distance_meters: number }[]>`
      SELECT
        id,
        ST_Distance(
          coordinates,
          ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography
        ) AS distance_meters
      FROM properties
      WHERE coordinates IS NOT NULL
        AND ST_DWithin(
          coordinates,
          ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY distance_meters ASC
    `;
    return rows.map((row: { id: string; distance_meters: number }) => ({
      id: row.id,
      distanceMeters: row.distance_meters,
    }));
  },
};
