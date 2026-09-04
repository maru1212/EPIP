import { prisma } from "@/lib/db";

/**
 * Raw SQL, same reasoning as every other repository touching PostGIS
 * columns in this project: `LocationNode.boundary` is `Unsupported` in
 * schema.prisma (Prisma has no native geometry type), so it can only be
 * read via `$queryRaw`/`$queryRawUnsafe`.
 */

export interface LocationNodeRecord {
  id: string;
  parentId: string | null;
  level: string;
  name: string;
  slug: string;
  /**
   * A representative point for this location, derived from its boundary
   * polygon's centroid — null when no boundary has been recorded. No
   * real boundary data is seeded anywhere in this project yet (see
   * schema.prisma's comment on LocationNode.boundary: "Not populated in
   * Task 2"), so in practice this is null for every location node until
   * real administrative-boundary data is loaded — see
   * docs/frontend-portal.md.
   */
  centroid: { latitude: number; longitude: number } | null;
}

async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

interface LocationRow {
  id: string;
  parent_id: string | null;
  level: string;
  name: string;
  slug: string;
  centroid_lon: number | null;
  centroid_lat: number | null;
}

function toRecord(row: LocationRow): LocationNodeRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    level: row.level,
    name: row.name,
    slug: row.slug,
    centroid:
      row.centroid_lon !== null && row.centroid_lat !== null
        ? { longitude: row.centroid_lon, latitude: row.centroid_lat }
        : null,
  };
}

export interface LocationRepository {
  /** All location nodes, optionally filtered to a specific hierarchy level. */
  listAll(level?: string): Promise<LocationNodeRecord[]>;
}

export const prismaLocationRepository: LocationRepository = {
  async listAll(level) {
    const sql = `
      SELECT id, parent_id, level, name, slug,
        ST_X(ST_Centroid(boundary)) AS centroid_lon,
        ST_Y(ST_Centroid(boundary)) AS centroid_lat
      FROM location_nodes
      ${level ? `WHERE level = $1::"LocationLevel"` : ""}
      ORDER BY name ASC
    `;
    const rows = level
      ? await queryRawUnsafe<LocationRow>(sql, level)
      : await queryRawUnsafe<LocationRow>(sql);
    return rows.map(toRecord);
  },
};
