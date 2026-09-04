import { prisma } from "@/lib/db";
import type { PermissionKey } from "../permissions";

/**
 * Narrow, purpose-built contract — this repository answers exactly one
 * question ("what can this user do") rather than exposing generic
 * Role/Permission CRUD, which nothing in this codebase needs yet.
 */
export interface PermissionRepository {
  /**
   * The union of permission keys granted by every role the user holds.
   * A user with no roles (or a nonexistent user) gets an empty set —
   * never an error; "no permissions" is a completely ordinary answer to
   * this question, not a failure.
   */
  getPermissionKeysForUser(userId: string): Promise<Set<PermissionKey>>;
}

export const prismaPermissionRepository: PermissionRepository = {
  async getPermissionKeysForUser(userId) {
    // One query: every Permission reachable from this user via
    // UserRole -> Role -> RolePermission. Ordinary relational filtering,
    // no PostGIS/analytics-style raw SQL needed here.
    const permissions = await prisma.permission.findMany({
      where: {
        rolePermissions: {
          some: {
            role: {
              userRoles: {
                some: { userId },
              },
            },
          },
        },
      },
      select: { key: true },
    });

    return new Set(permissions.map((p: { key: string }) => p.key as PermissionKey));
  },
};
