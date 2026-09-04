import { describe, expect, it } from "vitest";
import { createPolicyService } from "@/modules/identity/policies";
import type { PermissionRepository } from "@/modules/identity/repositories/permissionRepository";
import type { PermissionKey } from "@/modules/identity/permissions";

function createFakePermissionRepository(
  grants: Record<string, PermissionKey[]>
): PermissionRepository {
  return {
    async getPermissionKeysForUser(userId) {
      return new Set(grants[userId] ?? []);
    },
  };
}

describe("policyService.can", () => {
  it("allows when the user's permission set includes the requested permission", async () => {
    const repository = createFakePermissionRepository({
      "user-1": ["property:view", "property:create"],
    });
    const service = createPolicyService(repository);

    await expect(service.can("user-1", "property:create")).resolves.toBe(true);
  });

  it("denies when the user's permission set does not include the requested permission", async () => {
    const repository = createFakePermissionRepository({
      "user-1": ["property:view"],
    });
    const service = createPolicyService(repository);

    await expect(service.can("user-1", "user:manage")).resolves.toBe(false);
  });

  it("denies a user with no roles/permissions at all", async () => {
    const repository = createFakePermissionRepository({});
    const service = createPolicyService(repository);

    await expect(service.can("user-with-no-roles", "property:view")).resolves.toBe(
      false
    );
  });

  it("denies a nonexistent user rather than throwing", async () => {
    const repository = createFakePermissionRepository({ "user-1": ["property:view"] });
    const service = createPolicyService(repository);

    await expect(service.can("nonexistent-user", "property:view")).resolves.toBe(
      false
    );
  });

  /**
   * Table-driven check against every launch role's actual permission
   * grant (see prisma/seed.ts), so a change to the seed data that
   * silently narrows or widens a role's access gets caught here too, not
   * just in prisma/seed.ts itself.
   */
  const roleGrants: Record<string, PermissionKey[]> = {
    guest: ["property:view", "listing:view", "inquiry:create"],
    buyer: ["property:view", "listing:view", "favorite:create", "inquiry:create"],
    seller: [
      "property:view",
      "property:create",
      "property:update",
      "property:delete",
      "listing:view",
      "listing:create",
      "listing:update",
      "listing:delete",
      "favorite:create",
      "inquiry:create",
    ],
    agent: [
      "property:view",
      "property:create",
      "property:update",
      "property:delete",
      "listing:view",
      "listing:create",
      "listing:update",
      "listing:delete",
      "favorite:create",
      "inquiry:create",
    ],
    agency_admin: [
      "property:view",
      "property:create",
      "property:update",
      "property:delete",
      "listing:view",
      "listing:create",
      "listing:update",
      "listing:delete",
      "favorite:create",
      "inquiry:create",
      "agency:manage",
    ],
    market_researcher: ["property:view", "listing:view", "property:verify", "audit:view"],
    platform_admin: [
      "property:view",
      "property:create",
      "property:update",
      "property:delete",
      "listing:view",
      "listing:create",
      "listing:update",
      "listing:delete",
      "favorite:create",
      "inquiry:create",
      "agency:manage",
      "user:manage",
      "property:verify",
      "audit:view",
    ],
  };

  const allPermissions: PermissionKey[] = [
    "property:view",
    "property:create",
    "property:update",
    "property:delete",
    "listing:view",
    "listing:create",
    "listing:update",
    "listing:delete",
    "favorite:create",
    "inquiry:create",
    "agency:manage",
    "user:manage",
    "property:verify",
    "audit:view",
  ];

  for (const [role, grantedPermissions] of Object.entries(roleGrants)) {
    describe(`role: ${role}`, () => {
      const repository = createFakePermissionRepository({ [role]: grantedPermissions });
      const service = createPolicyService(repository);

      for (const permission of allPermissions) {
        const shouldBeAllowed = grantedPermissions.includes(permission);
        it(`${shouldBeAllowed ? "allows" : "denies"} "${permission}"`, async () => {
          await expect(service.can(role, permission)).resolves.toBe(shouldBeAllowed);
        });
      }
    });
  }
});
