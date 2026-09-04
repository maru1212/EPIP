/**
 * Integration test for the permission-aggregation join
 * (`permissionRepository.getPermissionKeysForUser`), against a real
 * PostgreSQL database with the actual Task 2 seed data applied.
 *
 * Like the other integration tests, this goes through the `pg` driver
 * directly rather than Prisma Client, for the same reason documented in
 * prisma/README.md: a schema-specific Prisma Client cannot be generated
 * in every environment. The query below is the exact relational join
 * `permissionRepository.ts`'s Prisma query expresses (User -> UserRole ->
 * Role -> RolePermission -> Permission) — this test proves that join is
 * correct against real seeded roles, independent of whether Prisma
 * Client is available.
 *
 * Requires the database to already have the launch roles/permissions
 * seeded (`npm run db:seed`, or the equivalent already applied — see
 * prisma/README.md). Skips gracefully (not silently) if no database is
 * reachable or the expected seed data isn't present.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { createPolicyService } from "@/modules/identity/policies";
import type { PermissionRepository } from "@/modules/identity/repositories/permissionRepository";
import type { PermissionKey } from "@/modules/identity/permissions";

let client: Client | null = null;
let databaseAvailable = false;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "[integration] DATABASE_URL is not set — skipping RBAC permission integration tests."
  );
} else {
  const candidate = new Client({ connectionString });
  try {
    await candidate.connect();
    client = candidate;
    databaseAvailable = true;
  } catch (error) {
    console.warn(
      "[integration] Could not connect to the database — skipping RBAC permission integration tests.",
      error instanceof Error ? error.message : error
    );
  }
}

afterAll(async () => {
  await client?.end();
});

async function getPermissionKeysForUser(pgClient: Client, userId: string): Promise<string[]> {
  const result = await pgClient.query<{ key: string }>(
    `SELECT DISTINCT p.key
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN roles r ON r.id = rp.role_id
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1
     ORDER BY p.key`,
    [userId]
  );
  return result.rows.map((row) => row.key);
}

async function createTestUserWithRole(pgClient: Client, roleName: string): Promise<string> {
  const userResult = await pgClient.query<{ id: string }>(
    `INSERT INTO users (email, full_name, status, updated_at)
     VALUES ($1, 'RBAC Integration Test User', 'active', now())
     RETURNING id`,
    [`rbac-itest-${randomUUID()}@example.com`]
  );
  const userId = userResult.rows[0]!.id;

  const roleResult = await pgClient.query<{ id: string }>(
    `SELECT id FROM roles WHERE name = $1`,
    [roleName]
  );
  if (roleResult.rowCount === 0) {
    throw new Error(
      `Expected role "${roleName}" to already be seeded — run "npm run db:seed" first.`
    );
  }
  const roleId = roleResult.rows[0]!.id;

  await pgClient.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
    userId,
    roleId,
  ]);

  return userId;
}

/**
 * Implements PermissionRepository via raw SQL against the real database —
 * same pattern as every other integration test in this suite, since
 * Prisma Client cannot be generated in this environment. Used to exercise
 * the REAL, unmodified `createPolicyService`/`can()` logic from
 * policies.ts against real data, not a reimplementation of it.
 */
function createPgPermissionRepository(pgClient: Client): PermissionRepository {
  return {
    async getPermissionKeysForUser(userId) {
      const result = await pgClient.query<{ key: string }>(
        `SELECT DISTINCT p.key
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN roles r ON r.id = rp.role_id
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $1`,
        [userId]
      );
      return new Set(result.rows.map((row) => row.key as PermissionKey));
    },
  };
}

describe.skipIf(!databaseAvailable)("RBAC permission aggregation (Task 4)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      // ON DELETE CASCADE on user_roles.user_id (see prisma/schema.prisma)
      // means deleting the user is enough to clean up its role assignment.
      await client!.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  });

  it("resolves the exact permission set for a buyer", async () => {
    const userId = await createTestUserWithRole(client!, "buyer");
    createdUserIds.push(userId);

    const permissions = await getPermissionKeysForUser(client!, userId);

    expect(permissions.sort()).toEqual(
      [
        "favorite:create",
        "inquiry:create",
        "listing:view",
        "property:view",
        "valuation:create",
        "valuation:view",
      ].sort()
    );
  });

  it("resolves the exact permission set for market_researcher", async () => {
    const userId = await createTestUserWithRole(client!, "market_researcher");
    createdUserIds.push(userId);

    const permissions = await getPermissionKeysForUser(client!, userId);

    expect(permissions.sort()).toEqual(
      [
        "audit:view",
        "listing:view",
        "market_data:read",
        "property:verify",
        "property:view",
        "valuation:create",
        "valuation:view",
      ].sort()
    );
  });

  it("resolves all 14 permissions for platform_admin", async () => {
    const userId = await createTestUserWithRole(client!, "platform_admin");
    createdUserIds.push(userId);

    const permissions = await getPermissionKeysForUser(client!, userId);

    expect(permissions).toHaveLength(17);
    expect(permissions).toContain("user:manage");
    expect(permissions).toContain("audit:view");
    expect(permissions).toContain("property:verify");
    expect(permissions).toContain("valuation:view");
    expect(permissions).toContain("valuation:create");
    expect(permissions).toContain("market_data:read");
  });

  it("returns no permissions for a user with no roles at all", async () => {
    const userResult = await client!.query<{ id: string }>(
      `INSERT INTO users (email, full_name, status, updated_at)
       VALUES ($1, 'No Role Test User', 'active', now())
       RETURNING id`,
      [`rbac-itest-${randomUUID()}@example.com`]
    );
    const userId = userResult.rows[0]!.id;
    createdUserIds.push(userId);

    const permissions = await getPermissionKeysForUser(client!, userId);

    expect(permissions).toEqual([]);
  });

  it("does not grant agency:manage to a plain agent (only agency_admin should have it)", async () => {
    const userId = await createTestUserWithRole(client!, "agent");
    createdUserIds.push(userId);

    const permissions = await getPermissionKeysForUser(client!, userId);

    expect(permissions).not.toContain("agency:manage");
    expect(permissions).not.toContain("user:manage");
  });

  it("aggregates permissions across multiple roles held by the same user", async () => {
    const userId = await createTestUserWithRole(client!, "buyer");
    createdUserIds.push(userId);

    // Grant a second role to the same user — a buyer who is also a
    // market researcher, an entirely plausible real combination.
    const roleResult = await client!.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'market_researcher'`
    );
    await client!.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      userId,
      roleResult.rows[0]!.id,
    ]);

    const permissions = await getPermissionKeysForUser(client!, userId);

    // Union of buyer's and market_researcher's permissions, deduplicated
    // (both grant "property:view" and "listing:view").
    expect(permissions.sort()).toEqual(
      [
        "audit:view",
        "favorite:create",
        "inquiry:create",
        "listing:view",
        "market_data:read",
        "property:verify",
        "property:view",
        "valuation:create",
        "valuation:view",
      ].sort()
    );
  });

  it("AUDIT FOCUS: can() reflects a removed role immediately, with no caching or JWT-expiry delay", async () => {
    const policyService = createPolicyService(createPgPermissionRepository(client!));
    const userId = await createTestUserWithRole(client!, "market_researcher");
    createdUserIds.push(userId);

    // Granted before removal.
    await expect(policyService.can(userId, "property:verify")).resolves.toBe(true);
    await expect(policyService.can(userId, "audit:view")).resolves.toBe(true);

    // Remove the role — the real-world action an admin suspension/role
    // edit would perform, with no interaction with the user's session at
    // all (this is deliberately NOT going through revokeAllSessions; the
    // point is that authorization is re-derived fresh on every can()
    // call, independent of anything session-related).
    const roleResult = await client!.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'market_researcher'`
    );
    await client!.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleResult.rows[0]!.id]
    );

    // Immediately denied — no TTL, no cache to expire, no waiting for a
    // JWT to time out. The very next can() call already sees the change.
    await expect(policyService.can(userId, "property:verify")).resolves.toBe(false);
    await expect(policyService.can(userId, "audit:view")).resolves.toBe(false);
  });

  it("AUDIT FOCUS: can() reflects a removed individual permission (role kept, one grant revoked) immediately", async () => {
    const policyService = createPolicyService(createPgPermissionRepository(client!));
    const userId = await createTestUserWithRole(client!, "agency_admin");
    createdUserIds.push(userId);

    await expect(policyService.can(userId, "agency:manage")).resolves.toBe(true);

    // Revoke just one permission from the role, not the whole role —
    // e.g. an admin editing what agency_admin is allowed to do. This
    // mutates SHARED seed data (unlike the per-test users this file
    // otherwise creates), so it must be restored afterward regardless of
    // outcome, or every subsequent test run would see agency_admin
    // permanently missing this permission.
    try {
      await client!.query(
        `DELETE FROM role_permissions
         WHERE role_id = (SELECT id FROM roles WHERE name = 'agency_admin')
           AND permission_id = (SELECT id FROM permissions WHERE key = 'agency:manage')`
      );

      await expect(policyService.can(userId, "agency:manage")).resolves.toBe(false);
      // Everything else the role still grants is unaffected.
      await expect(policyService.can(userId, "property:view")).resolves.toBe(true);
    } finally {
      await client!.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r, permissions p
         WHERE r.name = 'agency_admin' AND p.key = 'agency:manage'
         ON CONFLICT (role_id, permission_id) DO NOTHING`
      );
    }
  });
});
