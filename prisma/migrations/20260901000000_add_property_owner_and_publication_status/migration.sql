-- Task 5 (Core Property & Spatial Domain Layer): adds ownership tracking
-- and a publication-lifecycle status to Property.
--
-- Hand-authored for the same reason as every prior migration in this
-- project: the Prisma CLI's schema-engine binary cannot be downloaded in
-- this environment (network egress to binaries.prisma.sh is blocked —
-- see prisma/README.md). Mirrors exactly what `prisma migrate dev` would
-- generate from the updated prisma/schema.prisma. Applied and verified
-- against a real local PostgreSQL 16 + PostGIS 3.4 instance.

-- CreateEnum
CREATE TYPE "PropertyPublicationStatus" AS ENUM ('draft', 'published', 'archived');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "properties" ADD COLUMN "publication_status" "PropertyPublicationStatus" NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "properties_owner_user_id_idx" ON "properties"("owner_user_id");

-- CreateIndex
CREATE INDEX "properties_publication_status_idx" ON "properties"("publication_status");

-- AddForeignKey
-- Restrict, not Cascade/SetNull: consistent with this schema's policy of
-- never silently losing the trail of who owns a record. Users are
-- expected to be suspended (User.status), not deleted.
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
