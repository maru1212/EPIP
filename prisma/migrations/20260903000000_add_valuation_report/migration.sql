-- Task 7: ValuationReport — automated (and, later, professional) market
-- valuations for a Property.
--
-- Hand-authored for the same reason as every prior migration in this
-- project: the Prisma CLI's schema-engine binary cannot be downloaded in
-- this environment (network egress to binaries.prisma.sh is blocked —
-- see prisma/README.md). Mirrors exactly what `prisma migrate dev` would
-- generate from the updated prisma/schema.prisma. Applied and verified
-- against a real local PostgreSQL 16 + PostGIS 3.4 instance.

-- CreateEnum
CREATE TYPE "ValuationMethodology" AS ENUM ('comparable_sales', 'cost_approach', 'hybrid');

-- CreateEnum
CREATE TYPE "ValuationStatus" AS ENUM ('draft', 'completed', 'archived');

-- CreateTable
CREATE TABLE "valuation_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "estimated_value" DECIMAL(16,2) NOT NULL,
    "low_estimate" DECIMAL(16,2) NOT NULL,
    "high_estimate" DECIMAL(16,2) NOT NULL,
    "confidence_score" DECIMAL(3,2) NOT NULL,
    "methodology" "ValuationMethodology" NOT NULL DEFAULT 'comparable_sales',
    "status" "ValuationStatus" NOT NULL DEFAULT 'completed',
    "raw_ai_response" JSONB,
    "valuation_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuation_reports_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
-- Defense-in-depth beyond application-layer validation, same pattern as
-- listings_price_positive (Task 6): these invariants must hold regardless
-- of what wrote the row.
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_values_positive"
  CHECK ("estimated_value" > 0 AND "low_estimate" > 0 AND "high_estimate" > 0);

-- AddCheckConstraint
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_low_le_high"
  CHECK ("low_estimate" <= "high_estimate");

-- AddCheckConstraint
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_estimated_in_range"
  CHECK ("estimated_value" >= "low_estimate" AND "estimated_value" <= "high_estimate");

-- AddCheckConstraint
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_confidence_score_range"
  CHECK ("confidence_score" >= 0 AND "confidence_score" <= 1);

-- CreateIndex
-- Historical valuation tracking for a property, most-recent-first — the
-- primary access pattern per the Task 7 spec.
CREATE INDEX "valuation_reports_property_id_created_at_idx" ON "valuation_reports"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "valuation_reports_requested_by_user_id_idx" ON "valuation_reports"("requested_by_user_id");

-- AddForeignKey
-- Restrict, not Cascade: deleting a Property or User that still has
-- valuation history attached must not silently destroy that history.
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
