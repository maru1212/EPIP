import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/withPermission";

/**
 * Deliberately minimal: this exists to prove the RBAC guard works
 * end-to-end (per Task 4's original acceptance criteria — a protected
 * endpoint returning 403 for a user lacking the permission and success
 * for one with it), not as a real admin feature. Gated behind
 * "user:manage" (an existing, already-seeded permission) rather than a
 * feature-specific permission invented for this purpose, since no admin
 * dashboard or user-management feature exists yet to attach this to.
 * Route handler stays thin — all the actual logic is in
 * requirePermission/policyService.
 */
export const GET = requirePermission("user:manage", async (_request, { userId }) => {
  return NextResponse.json({ ok: true, userId });
});
