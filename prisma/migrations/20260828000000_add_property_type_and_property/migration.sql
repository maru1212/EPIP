-- Task 5: PropertyType and Property (canonical physical-asset record),
-- including the PostGIS geography(Point, 4326) coordinates column.
--
-- Hand-authored for the same reason as the Task 2 and Task 3.1
-- migrations: the Prisma CLI's schema-engine binary cannot be downloaded
-- in the environment this was written in (network egress to
-- binaries.prisma.sh is blocked — see prisma/README.md). This mirrors
-- exactly what `prisma migrate dev` would generate from
-- prisma/schema.prisma, plus the manual PostGIS additions below. It has
-- been applied and verified against a real local PostgreSQL 16 +
-- PostGIS 3.4 instance — see the Task 5 report for what was checked.

-- CreateTable
CREATE TABLE "property_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label_amharic" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_types_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "PropertyCondition" AS ENUM ('new', 'excellent', 'good', 'needs_renovation', 'under_construction');

-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('completed', 'under_construction', 'planned');

-- CreateEnum
CREATE TYPE "LocationAccuracy" AS ENUM ('exact', 'approximate', 'unknown');

-- CreateEnum
CREATE TYPE "PropertyVerificationStatus" AS ENUM ('unverified', 'agent_submitted', 'verified', 'disputed');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_node_id" UUID NOT NULL,
    "property_type_id" UUID NOT NULL,
    "land_area_sqm" DECIMAL(12,2),
    "building_area_sqm" DECIMAL(12,2),
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "parking_spaces" INTEGER,
    "floor" INTEGER,
    "year_built" INTEGER,
    "condition" "PropertyCondition",
    "construction_status" "ConstructionStatus",
    "extra_attributes" JSONB,
    "display_address" TEXT,
    "landmark" TEXT,
    "address_description" TEXT,
    "completeness_score" DECIMAL(3,2),
    "location_accuracy" "LocationAccuracy",
    "verification_status" "PropertyVerificationStatus" NOT NULL DEFAULT 'unverified',
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- AddColumn
-- Prisma's `Unsupported(...)` fields are not created by `prisma migrate
-- dev` automatically pre-generation; added explicitly here, per the plan
-- to handle all PostGIS geometry/geography columns via raw SQL. geography
-- (not geometry) so ST_DWithin's distance argument is interpreted in
-- meters — see the schema comment on Property.coordinates.
ALTER TABLE "properties" ADD COLUMN "coordinates" geography(Point, 4326);

-- CreateIndex
CREATE UNIQUE INDEX "property_types_key_key" ON "property_types"("key");

-- CreateIndex
CREATE INDEX "properties_location_node_id_idx" ON "properties"("location_node_id");

-- CreateIndex
CREATE INDEX "properties_property_type_id_idx" ON "properties"("property_type_id");

-- CreateIndex
CREATE INDEX "properties_land_area_sqm_idx" ON "properties"("land_area_sqm");

-- CreateIndex
CREATE INDEX "properties_building_area_sqm_idx" ON "properties"("building_area_sqm");

-- CreateIndex
CREATE INDEX "properties_bedrooms_idx" ON "properties"("bedrooms");

-- CreateIndex
-- Spatial (GIST) index on the PostGIS geography column, required for
-- ST_DWithin radius queries to use an index rather than a full table scan.
-- Raw SQL, not Prisma-native index syntax — same pattern as
-- location_nodes_boundary_gist_idx in the Task 2 migration.
CREATE INDEX "properties_coordinates_gist_idx" ON "properties" USING GIST ("coordinates");

-- AddForeignKey
-- Restrict, not Cascade: a location node or property type still in use by
-- a property cannot be deleted out from under it. Same pattern as every
-- other foreign key in this schema (roles, location hierarchy).
ALTER TABLE "properties" ADD CONSTRAINT "properties_location_node_id_fkey" FOREIGN KEY ("location_node_id") REFERENCES "location_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_type_id_fkey" FOREIGN KEY ("property_type_id") REFERENCES "property_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
