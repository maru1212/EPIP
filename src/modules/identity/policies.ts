import {
  prismaPermissionRepository,
  type PermissionRepository,
} from "./repositories/permissionRepository";
import type { PermissionKey } from "./permissions";

/**
 * Factory rather than a bare singleton export, for the same reason as
 * authService and sessionSecurityService: it lets tests inject a fake
 * PermissionRepository and exercise the actual allow/deny logic with no
 * database involved. `policyService` below is the production instance.
 *
 * Deliberately re-queries the database on every call rather than trusting
 * anything cached in the JWT. This is a direct, intentional consequence of
 * the same reasoning behind session revocation (see
 * sessionSecurityService.ts and docs/authentication-hardening.md): a
 * user's role/permission assignments can change independently of their
 * session (an admin can revoke a role at any time), and embedding
 * permissions in the token would reintroduce exactly the kind of
 * stale-authorization bug that was just fixed for account suspension.
 * Consistency here matters more than saving a lookup — if this needs to
 * be cached later, cache `getPermissionKeysForUser`'s result briefly, not
 * the permission decision itself, and expect it to need invalidating on
 * role changes the same way security_version invalidates sessions.
 *
 * "Resource"-level authorization (e.g. "can this agent edit THIS
 * specific listing, as opposed to listings in general") is deliberately
 * out of scope here — there's no Property/Listing schema yet for
 * ownership checks to apply to. `can()` only answers "does this user's
 * role grant them this permission at all." Once real resources exist,
 * ownership checks should compose with `can()` at the call site (e.g.
 * "can(user, 'listing:update') AND listing.ownerId === user.id"), not be
 * folded into this function.
 */
export function createPolicyService(repository: PermissionRepository = prismaPermissionRepository) {
  return {
    async can(userId: string, permission: PermissionKey): Promise<boolean> {
      const permissions = await repository.getPermissionKeysForUser(userId);
      return permissions.has(permission);
    },
  };
}

export const policyService = createPolicyService();
