/**
 * Seeds:
 * - RBAC data: the launch permission set and roles (Task 2, plus Market
 *   Researcher added in Task 2's review).
 * - PropertyType lookup values (Task 5) — the extensible property-type
 *   list from the Phase 0 product brief. This is reference/lookup data,
 *   not a property record, so it's in scope here the same way roles and
 *   permissions are; "Do not create fake property records" (Task 2)
 *   refers to rows in the `properties` table, which this script still
 *   does not create.
 *
 * Idempotent: safe to run multiple times against the same database, since
 * every row is upserted on its natural unique key (permission `key`,
 * role `name`, property type `key`).
 */
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "../src/modules/identity/permissions";

const prisma = new PrismaClient();

const PROPERTY_TYPES = [
  { key: "house", label: "House" },
  { key: "apartment", label: "Apartment" },
  { key: "villa", label: "Villa" },
  { key: "land", label: "Land" },
  { key: "commercial", label: "Commercial" },
  { key: "office", label: "Office" },
  { key: "other", label: "Other" },
] as const;

const ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: "guest",
    description: "Unauthenticated visitor",
    permissions: ["property:view", "listing:view", "inquiry:create"],
  },
  {
    name: "buyer",
    description: "Authenticated buyer",
    permissions: [
      "property:view",
      "listing:view",
      "favorite:create",
      "inquiry:create",
      "valuation:view",
      "valuation:create",
    ],
  },
  {
    name: "seller",
    description: "Individual listing their own property without an agent",
    permissions: [
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
      "valuation:view",
      "valuation:create",
    ],
  },
  {
    name: "agent",
    description: "Represents property owners/clients",
    permissions: [
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
      "valuation:view",
      "valuation:create",
    ],
  },
  {
    name: "agency_admin",
    description: "Manages agents within an agency",
    permissions: [
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
      "valuation:view",
      "valuation:create",
    ],
  },
  {
    name: "market_researcher",
    description: "Reviews and corrects property/listing data quality",
    permissions: [
      "property:view",
      "listing:view",
      "property:verify",
      "audit:view",
      "valuation:view",
      "valuation:create",
      "market_data:read",
    ],
  },
  {
    name: "platform_admin",
    description: "Full platform administration",
    permissions: PERMISSIONS.map((p) => p.key),
  },
];

async function main() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }

  for (const role of ROLES) {
    const createdRole = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });

    for (const permissionKey of role.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: createdRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: createdRole.id,
          permissionId: permission.id,
        },
      });
    }
  }

  for (const propertyType of PROPERTY_TYPES) {
    await prisma.propertyType.upsert({
      where: { key: propertyType.key },
      update: { label: propertyType.label },
      create: propertyType,
    });
  }

  console.log(
    `Seeded ${PERMISSIONS.length} permissions, ${ROLES.length} roles, and ${PROPERTY_TYPES.length} property types.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
