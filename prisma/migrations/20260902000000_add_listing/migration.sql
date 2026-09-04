-- Task 6: Listing — a commercial offer against a Property.
--
-- Hand-authored for the same reason as every prior migration in this
-- project: the Prisma CLI's schema-engine binary cannot be downloaded in
-- this environment (network egress to binaries.prisma.sh is blocked —
-- see prisma/README.md). Mirrors exactly what `prisma migrate dev` would
-- generate from the updated prisma/schema.prisma. Applied and verified
-- against a real local PostgreSQL 16 + PostGIS 3.4 instance.

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('sale', 'rent');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'active', 'sold', 'rented', 'expired', 'archived');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "agent_user_id" UUID NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "contact_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
-- Defense-in-depth beyond Zod validation: a listing price can never be
-- persisted as zero or negative, even via a future direct-SQL path.
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_positive" CHECK ("price" > 0);

-- CreateIndex
CREATE INDEX "listings_property_id_idx" ON "listings"("property_id");

-- CreateIndex
CREATE INDEX "listings_agent_user_id_idx" ON "listings"("agent_user_id");

-- CreateIndex
-- Composite index for the commercial search path: status + listingType +
-- price together is the primary query shape for "active sale listings
-- under X price," etc.
CREATE INDEX "listings_status_listing_type_price_idx" ON "listings"("status", "listing_type", "price");

-- AddForeignKey
-- Restrict, not Cascade: deleting a Property or User that still has
-- Listings attached must not silently destroy commercial-offer history.
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
