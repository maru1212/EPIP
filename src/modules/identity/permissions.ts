/**
 * The canonical set of permission keys. Single source of truth — both
 * `prisma/seed.ts` (what gets written to the database) and
 * `modules/identity/policies.ts` (what callers are allowed to check for)
 * import from here, so the two can't drift out of sync with each other.
 *
 * Adding a new permission is a two-step, additive change: add it here,
 * then assign it to whichever roles should have it in `prisma/seed.ts`.
 * Nothing about the RBAC schema itself needs to change (see
 * prisma/README.md — Role/Permission/RolePermission/UserRole are
 * deliberately table-driven, not enums).
 */
export const PERMISSIONS = [
  { key: "property:view", description: "View property listings" },
  { key: "property:create", description: "Create a property record" },
  { key: "property:update", description: "Update a property record" },
  { key: "property:delete", description: "Delete a property record" },
  { key: "listing:view", description: "View a listing" },
  { key: "listing:create", description: "Create a listing" },
  { key: "listing:update", description: "Update a listing" },
  { key: "listing:delete", description: "Delete a listing" },
  { key: "favorite:create", description: "Save a property to favorites" },
  { key: "inquiry:create", description: "Submit an inquiry" },
  { key: "agency:manage", description: "Manage agents within an agency" },
  { key: "user:manage", description: "Manage user accounts" },
  { key: "property:verify", description: "Change a property's verification status" },
  { key: "audit:view", description: "View the audit log" },
  { key: "valuation:view", description: "View a saved valuation report" },
  { key: "valuation:create", description: "Generate an AI-enriched narrative valuation report" },
  { key: "market_data:read", description: "Read aggregated market/neighborhood statistics (B2B)" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
