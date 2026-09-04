import { prisma } from "@/lib/db";

/**
 * Unlike Property, Listing has no PostGIS column of its own — every field
 * here is a plain, Prisma-representable type. Kept in raw SQL anyway
 * (rather than the normal Prisma Client API, e.g. `prisma.listing.create`)
 * for a reason specific to this sandbox: a schema-specific Prisma Client
 * cannot be generated here (see prisma/README.md), so ORM calls against
 * the `any`-typed stub can't be verified against a real schema at all —
 * not even by inspection. Raw SQL can still be verified by running the
 * equivalent statement directly against the live database (see
 * tests/integration/listingRepository.test.ts), which is how every
 * repository in this project has been validated under this constraint.
 * Once `prisma generate` can run in a normal-network environment, this
 * could reasonably be rewritten to use `prisma.listing.*` directly —
 * nothing about Listing's shape requires raw SQL the way Property's
 * `coordinates` column does.
 */

export type ListingType = "sale" | "rent";
export type ListingStatus = "draft" | "active" | "sold" | "rented" | "expired" | "archived";

export interface ListingRecord {
  id: string;
  propertyId: string;
  agentUserId: string;
  listingType: ListingType;
  price: number;
  currency: string;
  negotiable: boolean;
  status: ListingStatus;
  contactInfo: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateListingInput {
  propertyId: string;
  agentUserId: string;
  listingType: ListingType;
  price: number;
  currency?: string;
  negotiable?: boolean;
  status?: ListingStatus;
  contactInfo?: unknown | null;
}

/**
 * Sparse-patch semantics, same as Property's `UpdatePropertyDetailsInput`:
 * only keys actually present are updated. Does not include `propertyId`/
 * `agentUserId`/`listingType` (re-parenting a listing to a different
 * property or changing what kind of offer it is isn't a "details edit")
 * or `status` (its own dedicated method — a status transition is a
 * distinct kind of action, same reasoning as Property's publicationStatus).
 */
export interface UpdateListingDetailsInput {
  price?: number;
  currency?: string;
  negotiable?: boolean;
  contactInfo?: unknown | null;
}

export interface ListingSearchFilters {
  propertyId?: string;
  agentUserId?: string;
  listingType?: ListingType;
  status?: ListingStatus;
  minPrice?: number;
  maxPrice?: number;
  /**
   * Property-level filters, applied via a join to `properties` — the
   * literal "price range AND spatial/location parameters simultaneously"
   * requirement from the Task 6 spec. A listing's own columns can't
   * express any of these; they all come from the property it advertises.
   */
  locationNodeId?: string;
  propertyTypeId?: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  minBuildingAreaSqm?: number;
  maxBuildingAreaSqm?: number;
  minLandAreaSqm?: number;
  maxLandAreaSqm?: number;
  near?: { center: { latitude: number; longitude: number }; radiusMeters: number };
  /**
   * When true, only listings whose Property is also `published` are
   * returned — the public-search default. An admin/agent-facing search
   * (not built as a route in this task, but supported here for future
   * reuse) could set this false to include listings on draft properties
   * they own.
   */
  requirePublishedProperty?: boolean;
  limit: number;
  offset: number;
}

export interface ListingRepository {
  create(input: CreateListingInput): Promise<ListingRecord>;
  findById(id: string): Promise<ListingRecord | null>;
  search(filters: ListingSearchFilters): Promise<ListingRecord[]>;
  /**
   * Same filtering as `search()`, but returns Property fields (coordinates,
   * area, bedrooms/bathrooms, condition) alongside each Listing — the
   * "aggregated search" shape Task 8's discovery endpoint needs, without
   * a second round-trip per result.
   */
  searchWithPropertyDetails(
    filters: ListingSearchFilters
  ): Promise<ListingWithPropertyDetails[]>;
  updateDetails(
    id: string,
    patch: UpdateListingDetailsInput
  ): Promise<ListingRecord | null>;
  updateStatus(id: string, status: ListingStatus): Promise<ListingRecord | null>;
}

async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  // Same stub-typing workaround as propertyRepository.ts: the
  // un-generated Prisma Client stub types `PrismaClient` as `any`, so an
  // explicit generic argument on `$queryRawUnsafe<T>(...)` is a
  // TypeScript error ("untyped function calls may not accept type
  // arguments"). Casting the result instead preserves the same effective
  // typing at every call site.
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

const LISTING_COLUMNS = `
  l.id, l.property_id, l.agent_user_id, l.listing_type, l.price, l.currency,
  l.negotiable, l.status, l.contact_info, l.created_at, l.updated_at
`;

interface ListingRow {
  id: string;
  property_id: string;
  agent_user_id: string;
  listing_type: ListingType;
  price: string;
  currency: string;
  negotiable: boolean;
  status: ListingStatus;
  contact_info: unknown | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: ListingRow): ListingRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    agentUserId: row.agent_user_id,
    listingType: row.listing_type,
    // Decimal columns come back from $queryRaw as strings, same reasoning
    // as propertyRepository.ts's landAreaSqm/buildingAreaSqm.
    price: Number(row.price),
    currency: row.currency,
    negotiable: row.negotiable,
    status: row.status,
    contactInfo: row.contact_info,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Mirrors propertyRepository.ts's WhereBuilder exactly. */
class WhereBuilder {
  conditions: string[] = [];
  params: unknown[] = [];

  add(sqlTemplate: string, value: unknown) {
    this.params.push(value);
    this.conditions.push(sqlTemplate.replace("?", `$${this.params.length}`));
  }

  nextParamIndexes(count: number): number[] {
    const start = this.params.length + 1;
    return Array.from({ length: count }, (_, i) => start + i);
  }

  pushParams(...values: unknown[]) {
    this.params.push(...values);
  }

  toSql(): string {
    return this.conditions.length > 0 ? `WHERE ${this.conditions.join(" AND ")}` : "";
  }
}

const UPDATABLE_COLUMNS: Record<keyof UpdateListingDetailsInput, string> = {
  price: "price",
  currency: "currency",
  negotiable: "negotiable",
  contactInfo: "contact_info",
};

/**
 * Shared between `search()` and `searchWithPropertyDetails()` (Task 8's
 * aggregated discovery search) — both filter the exact same
 * `listings l JOIN properties p` shape, differing only in which columns
 * they SELECT. Extracted here so the two can't drift out of sync with
 * each other's filtering behavior.
 */
function buildListingSearchWhereClause(filters: ListingSearchFilters): {
  where: WhereBuilder;
  orderBy: string;
} {
  const where = new WhereBuilder();

  if (filters.propertyId) {
    where.add("l.property_id = ?::uuid", filters.propertyId);
  }
  if (filters.agentUserId) {
    where.add("l.agent_user_id = ?::uuid", filters.agentUserId);
  }
  if (filters.listingType) {
    where.add('l.listing_type = ?::"ListingType"', filters.listingType);
  }
  if (filters.status) {
    where.add('l.status = ?::"ListingStatus"', filters.status);
  }
  if (filters.minPrice !== undefined) {
    where.add("l.price >= ?", filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    where.add("l.price <= ?", filters.maxPrice);
  }
  if (filters.requirePublishedProperty) {
    where.conditions.push(`p.publication_status = 'published'::"PropertyPublicationStatus"`);
  }
  if (filters.locationNodeId) {
    where.add("p.location_node_id = ?::uuid", filters.locationNodeId);
  }
  if (filters.propertyTypeId) {
    where.add("p.property_type_id = ?::uuid", filters.propertyTypeId);
  }
  if (filters.minBedrooms !== undefined) {
    where.add("p.bedrooms >= ?", filters.minBedrooms);
  }
  if (filters.maxBedrooms !== undefined) {
    where.add("p.bedrooms <= ?", filters.maxBedrooms);
  }
  if (filters.minBuildingAreaSqm !== undefined) {
    where.add("p.building_area_sqm >= ?", filters.minBuildingAreaSqm);
  }
  if (filters.maxBuildingAreaSqm !== undefined) {
    where.add("p.building_area_sqm <= ?", filters.maxBuildingAreaSqm);
  }
  if (filters.minLandAreaSqm !== undefined) {
    where.add("p.land_area_sqm >= ?", filters.minLandAreaSqm);
  }
  if (filters.maxLandAreaSqm !== undefined) {
    where.add("p.land_area_sqm <= ?", filters.maxLandAreaSqm);
  }
  if (filters.minBathrooms !== undefined) {
    where.add("p.bathrooms >= ?", filters.minBathrooms);
  }

  let orderBy = "ORDER BY l.created_at DESC";
  if (filters.near) {
    const [lonIdx, latIdx, radiusIdx] = where.nextParamIndexes(3);
    where.pushParams(
      filters.near.center.longitude,
      filters.near.center.latitude,
      filters.near.radiusMeters
    );
    where.conditions.push(
      `p.coordinates IS NOT NULL AND ST_DWithin(p.coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography, $${radiusIdx})`
    );
    orderBy = `ORDER BY ST_Distance(p.coordinates, ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography) ASC`;
  }

  return { where, orderBy };
}

export interface ListingWithPropertyDetails extends ListingRecord {
  coordinates: { latitude: number; longitude: number } | null;
  buildingAreaSqm: number | null;
  landAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  locationNodeId: string;
  propertyTypeId: string;
  condition: string | null;
}

export const prismaListingRepository: ListingRepository = {
  async create(input) {
    const rows = await queryRawUnsafe<ListingRow>(
      `INSERT INTO listings (
        property_id, agent_user_id, listing_type, price, currency,
        negotiable, status, contact_info, updated_at
      ) VALUES ($1::uuid, $2::uuid, $3::"ListingType", $4, $5, $6, $7::"ListingStatus", $8::jsonb, now())
      RETURNING id, property_id, agent_user_id, listing_type, price, currency,
                negotiable, status, contact_info, created_at, updated_at`,
      input.propertyId,
      input.agentUserId,
      input.listingType,
      input.price,
      input.currency ?? "ETB",
      input.negotiable ?? false,
      input.status ?? "draft",
      input.contactInfo !== undefined && input.contactInfo !== null
        ? JSON.stringify(input.contactInfo)
        : null
    );
    return toRecord(rows[0]!);
  },

  async findById(id) {
    const rows = await queryRawUnsafe<ListingRow>(
      `SELECT id, property_id, agent_user_id, listing_type, price, currency,
              negotiable, status, contact_info, created_at, updated_at
       FROM listings WHERE id = $1`,
      id
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async search(filters) {
    const { where, orderBy } = buildListingSearchWhereClause(filters);

    const [limitIdx, offsetIdx] = where.nextParamIndexes(2);
    where.pushParams(filters.limit, filters.offset);

    const sql = `
      SELECT ${LISTING_COLUMNS} FROM listings l
      JOIN properties p ON p.id = l.property_id
      ${where.toSql()}
      ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await queryRawUnsafe<ListingRow>(sql, ...where.params);
    return rows.map(toRecord);
  },

  async searchWithPropertyDetails(filters) {
    const { where, orderBy } = buildListingSearchWhereClause(filters);

    const [limitIdx, offsetIdx] = where.nextParamIndexes(2);
    where.pushParams(filters.limit, filters.offset);

    const sql = `
      SELECT ${LISTING_COLUMNS},
        ST_X(p.coordinates::geometry) AS longitude, ST_Y(p.coordinates::geometry) AS latitude,
        p.building_area_sqm, p.land_area_sqm, p.bedrooms, p.bathrooms,
        p.location_node_id, p.property_type_id, p.condition
      FROM listings l
      JOIN properties p ON p.id = l.property_id
      ${where.toSql()}
      ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await queryRawUnsafe<
      ListingRow & {
        longitude: number | null;
        latitude: number | null;
        building_area_sqm: string | null;
        land_area_sqm: string | null;
        bedrooms: number | null;
        bathrooms: number | null;
        location_node_id: string;
        property_type_id: string;
        condition: string | null;
      }
    >(sql, ...where.params);

    return rows.map((row) => ({
      ...toRecord(row),
      coordinates:
        row.longitude !== null && row.latitude !== null
          ? { longitude: row.longitude, latitude: row.latitude }
          : null,
      buildingAreaSqm: row.building_area_sqm !== null ? Number(row.building_area_sqm) : null,
      landAreaSqm: row.land_area_sqm !== null ? Number(row.land_area_sqm) : null,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      locationNodeId: row.location_node_id,
      propertyTypeId: row.property_type_id,
      condition: row.condition,
    }));
  },

  async updateDetails(id, patch) {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const key of Object.keys(patch) as (keyof UpdateListingDetailsInput)[]) {
      if (!(key in UPDATABLE_COLUMNS)) continue; // whitelist only
      const column = UPDATABLE_COLUMNS[key];
      const value = patch[key];
      params.push(
        key === "contactInfo" && value !== null && value !== undefined
          ? JSON.stringify(value)
          : (value ?? null)
      );
      const cast = key === "contactInfo" ? "::jsonb" : "";
      setClauses.push(`${column} = $${params.length}${cast}`);
    }

    if (setClauses.length === 0) {
      return prismaListingRepository.findById(id);
    }

    setClauses.push("updated_at = now()");
    params.push(id);

    const rows = await queryRawUnsafe<ListingRow>(
      `UPDATE listings SET ${setClauses.join(", ")} WHERE id = $${params.length}
       RETURNING id, property_id, agent_user_id, listing_type, price, currency,
                 negotiable, status, contact_info, created_at, updated_at`,
      ...params
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async updateStatus(id, status) {
    const rows = await queryRawUnsafe<ListingRow>(
      `UPDATE listings SET status = $1::"ListingStatus", updated_at = now()
       WHERE id = $2
       RETURNING id, property_id, agent_user_id, listing_type, price, currency,
                 negotiable, status, contact_info, created_at, updated_at`,
      status,
      id
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },
};
