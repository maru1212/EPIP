-- Task 3 hardening: session revocation (per-user security version) and
-- rate limiting (Postgres-backed, multi-instance-safe bucket table).
--
-- Hand-authored for the same reason as the Task 2 migration: the Prisma
-- CLI's schema-engine binary could not be downloaded in the environment
-- this was written in (network egress to binaries.prisma.sh was blocked).
-- Mirrors exactly what `prisma migrate dev` would generate from the
-- updated prisma/schema.prisma. Applied and verified against a real local
-- PostgreSQL 16 + PostGIS 3.4 instance — see prisma/README.md.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "security_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_buckets_key_window_start_key" ON "rate_limit_buckets"("key", "window_start");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_key_idx" ON "rate_limit_buckets"("key");
