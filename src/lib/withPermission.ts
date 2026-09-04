import { auth } from "@/lib/auth";
import { policyService } from "@/modules/identity/policies";
import type { PermissionKey } from "@/modules/identity/permissions";
import type { Session } from "next-auth";
import { errorResponse } from "@/lib/apiResponse";

interface PermissionGuardDependencies {
  getSession: () => Promise<Session | null>;
  can: (userId: string, permission: PermissionKey) => Promise<boolean>;
}

/**
 * Factory, not a bare export — the same dependency-injection pattern used
 * throughout the identity module (authService, sessionSecurityService,
 * policyService itself). `requirePermission` below is the production
 * instance route handlers actually import; tests construct their own via
 * `createPermissionGuard({ getSession: fakeAuth, can: fakeCan })` to
 * exercise the 401/403/pass-through branches with no real session or
 * database involved.
 *
 * `getSession` defaults to `auth()` from lib/auth.ts, which — per the
 * Task 3 hardening follow-up — already enforces session revocation
 * (suspended accounts, explicitly revoked security versions) on every
 * call. This guard does not re-check that itself; it trusts `auth()` to
 * only ever return a session that's genuinely still valid.
 */
export function createPermissionGuard(
  deps: Partial<PermissionGuardDependencies> = {}
) {
  const getSession = deps.getSession ?? auth;
  const can = deps.can ?? policyService.can;

  /**
   * Wraps a route handler so it only runs for an authenticated user who
   * holds `permission`. Returns 401 (no session) or 403 (session exists,
   * permission denied) otherwise — the handler itself never has to think
   * about authorization.
   *
   * `...rest` forwards any additional arguments Next.js passes to a route
   * handler — most importantly, a dynamic route's `{ params }` context
   * (e.g. `/api/properties/[id]`). Without this, a guarded dynamic route
   * would silently receive `params: undefined` in the wrapped handler,
   * since Next.js always calls `handler(request, { params })` for
   * `[id]`-style routes but the original version of this function only
   * forwarded `request`. Generic over `Rest` so this stays correctly
   * typed at each call site rather than falling back to `any`.
   */
  return function requirePermission<Rest extends unknown[] = []>(
    permission: PermissionKey,
    handler: (
      request: Request,
      context: { userId: string },
      ...rest: Rest
    ) => Promise<Response>
  ) {
    return async function guardedHandler(
      request: Request,
      ...rest: Rest
    ): Promise<Response> {
      const session = await getSession();
      const userId = session?.user?.id;

      if (!userId) {
        return errorResponse("unauthorized", "Sign in required.", { status: 401 });
      }

      const allowed = await can(userId, permission);
      if (!allowed) {
        return errorResponse(
          "forbidden",
          "You do not have permission to perform this action.",
          { status: 403 }
        );
      }

      return handler(request, { userId }, ...rest);
    };
  };
}

/**
 * The production instance. `requirePermission("property:verify", handler)`
 * is the intended call shape for real route handlers.
 */
export const requirePermission = createPermissionGuard();
