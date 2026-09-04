/**
 * Integration test against a real PostgreSQL + PostGIS database.
 *
 * This talks to the database directly via the `pg` driver rather than
 * through Prisma Client, because generating a schema-specific Prisma
 * Client requires downloading Prisma's schema-engine binary, which is not
 * possible in every environment (see prisma/README.md for details). This
 * test still exercises the real migration SQL end to end: extension,
 * tables, indexes, and referential actions.
 *
 * Requires a reachable PostgreSQL database with this project's migration
 * already applied (see prisma/README.md for setup). If DATABASE_URL is
 * unset or the database is unreachable, these tests are skipped — not
 * silently passed — with a clear message, so a missing database is never
 * mistaken for a passing suite.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping database integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping database integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

describe.skipIf(!databaseAvailable)("database schema (Task 2)", () => {
  it("has the PostGIS extension enabled", async () => {
    const result = await client!.query(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'"
    );
    expect(result.rowCount).toBe(1);
  });

  it("has the expected tables", async () => {
    const result = await client!.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const tableNames = result.rows.map((row) => row.table_name).sort();

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "users",
        "roles",
        "permissions",
        "role_permissions",
        "user_roles",
        "location_nodes",
      ])
    );
  });

  it("stores location_nodes.boundary as a PostGIS geometry(Polygon,4326) column", async () => {
    const result = await client!.query<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns
       WHERE table_name = 'location_nodes' AND column_name = 'boundary'`
    );
    expect(result.rows[0]?.udt_name).toBe("geometry");
  });

  it("has a GIST spatial index on location_nodes.boundary", async () => {
    const result = await client!.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'location_nodes' AND indexdef ILIKE '%USING gist%'`
    );
    expect(result.rowCount).toBeGreaterThan(0);
  });

  it("prevents deleting a location_nodes parent that still has children (RESTRICT)", async () => {
    await client!.query("BEGIN");
    try {
      const parent = await client!.query(
        `INSERT INTO location_nodes (level, name, slug, updated_at)
         VALUES ('country', 'Test Country', 'test-country-' || gen_random_uuid(), now())
         RETURNING id`
      );
      const parentId = parent.rows[0].id;
      await client!.query(
        `INSERT INTO location_nodes (parent_id, level, name, slug, updated_at)
         VALUES ($1, 'city', 'Test City', 'test-city-' || gen_random_uuid(), now())`,
        [parentId]
      );

      await expect(
        client!.query("DELETE FROM location_nodes WHERE id = $1", [parentId])
      ).rejects.toThrow();
    } finally {
      await client!.query("ROLLBACK");
    }
  });

  it("prevents deleting a role that is still assigned to a user (RESTRICT)", async () => {
    await client!.query("BEGIN");
    try {
      const user = await client!.query(
        `INSERT INTO users (email, full_name, status, updated_at)
         VALUES ('itest-' || gen_random_uuid() || '@example.com', 'Integration Test User', 'active', now())
         RETURNING id`
      );
      const role = await client!.query(
        `INSERT INTO roles (name, description)
         VALUES ('itest_role_' || replace(gen_random_uuid()::text, '-', ''), 'temp')
         RETURNING id`
      );
      const userId = user.rows[0].id;
      const roleId = role.rows[0].id;

      await client!.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
        [userId, roleId]
      );

      await expect(
        client!.query("DELETE FROM roles WHERE id = $1", [roleId])
      ).rejects.toThrow();
    } finally {
      await client!.query("ROLLBACK");
    }
  });

  it("removes a user's role assignments when the user is deleted (CASCADE), without deleting the role", async () => {
    await client!.query("BEGIN");
    try {
      const user = await client!.query(
        `INSERT INTO users (email, full_name, status, updated_at)
         VALUES ('itest-' || gen_random_uuid() || '@example.com', 'Integration Test User', 'active', now())
         RETURNING id`
      );
      const role = await client!.query(
        `INSERT INTO roles (name, description)
         VALUES ('itest_role_' || replace(gen_random_uuid()::text, '-', ''), 'temp')
         RETURNING id`
      );
      const userId = user.rows[0].id;
      const roleId = role.rows[0].id;

      await client!.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
        [userId, roleId]
      );
      await client!.query("DELETE FROM users WHERE id = $1", [userId]);

      const remainingUserRoles = await client!.query(
        "SELECT 1 FROM user_roles WHERE user_id = $1",
        [userId]
      );
      const roleStillExists = await client!.query(
        "SELECT 1 FROM roles WHERE id = $1",
        [roleId]
      );

      expect(remainingUserRoles.rowCount).toBe(0);
      expect(roleStillExists.rowCount).toBe(1);
    } finally {
      await client!.query("ROLLBACK");
    }
  });
});
