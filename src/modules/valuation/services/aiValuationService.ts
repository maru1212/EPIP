import { prisma } from "@/lib/db";
import {
  valuationService as defaultValuationService,
  type EstimateOutcome,
  type RequestContext,
} from "./valuationService";
import {
  prismaValuationRepository,
  type ValuationRepository,
  type ValuationReportRecord,
} from "../repositories/valuationRepository";
import {
  prismaPropertyRepository,
  type PropertyRepository,
} from "@/modules/property/repositories/propertyRepository";
import { createAIProvider } from "./aiProviders/createAIProvider";
import {
  AIProviderError,
  type AIValuationProvider,
  type NarrativeGenerationOutput,
} from "./aiProviders/aiProvider";
import { env } from "@/lib/env";

/**
 * The minimal slice of `valuationService` this module depends on —
 * typed narrowly rather than importing the full service's return type,
 * so a test can inject a fake without constructing every other method.
 * `getReport` throws (ValuationReportNotFoundError/
 * ForbiddenValuationActionError) rather than returning null/undefined —
 * `getAiSummary` below relies on that and doesn't duplicate the check.
 */
export interface StatisticalEstimator {
  estimateValue(propertyId: string, context: RequestContext): Promise<EstimateOutcome>;
  getReport(id: string, context: { userId?: string }): Promise<ValuationReportRecord>;
}

export type AiReportOutcome =
  | { persisted: true; aiEnriched: true; report: ValuationReportRecord }
  | { persisted: true; aiEnriched: false; report: ValuationReportRecord; reason: string }
  | { persisted: false; comparableCount: 0; reason: "insufficient_comparable_data" };

export interface AiSummaryResult {
  reportId: string;
  aiEnriched: boolean;
  narrative: NarrativeGenerationOutput | null;
  aiProvider: string | null;
}

async function queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

/** Ancestor chain, most specific first (e.g. ["Bole", "Addis Ababa"]). */
async function getLocationChain(locationNodeId: string): Promise<string[]> {
  const rows = await queryRawUnsafe<{ name: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, name, 0 AS depth FROM location_nodes WHERE id = $1
       UNION ALL
       SELECT ln.id, ln.parent_id, ln.name, a.depth + 1
       FROM location_nodes ln
       JOIN ancestors a ON ln.id = a.parent_id
     )
     SELECT name FROM ancestors ORDER BY depth ASC`,
    locationNodeId
  );
  return rows.map((r) => r.name);
}

async function getPropertyTypeKey(propertyTypeId: string): Promise<string> {
  const rows = await queryRawUnsafe<{ key: string }>(
    `SELECT key FROM property_types WHERE id = $1`,
    propertyTypeId
  );
  return rows[0]?.key ?? "property";
}

/**
 * A provider call is raced against a timeout — a provider that hangs
 * indefinitely (rather than erroring or returning) must not hang the
 * whole request. Rejects with `AIProviderError` on timeout, same as
 * every other provider failure mode, so callers only need one catch
 * path.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AIProviderError(`AI provider did not respond within ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Extracts the statistical fields already computed and persisted by
 * `valuationService.estimateValue` (in `valuationData`) — this service
 * does not recompute anything, only adds narrative on top.
 */
function extractStatisticalContext(report: ValuationReportRecord): {
  medianComparablePricePerSqm: number | null;
  comparableCount: number;
  coefficientOfVariation: number | null;
} {
  const data =
    typeof report.valuationData === "object" && report.valuationData !== null
      ? (report.valuationData as Record<string, unknown>)
      : {};
  return {
    medianComparablePricePerSqm:
      typeof data.medianPricePerSqm === "number" ? data.medianPricePerSqm : null,
    comparableCount: typeof data.comparableCount === "number" ? data.comparableCount : 0,
    coefficientOfVariation:
      typeof data.coefficientOfVariation === "number" ? data.coefficientOfVariation : null,
  };
}

/**
 * Small, separate interface for the two raw lookups this service needs
 * beyond what `PropertyRepository`/`ValuationRepository` already expose
 * — kept as its own injectable dependency (rather than hardcoding a
 * direct `prisma` call inside the service body) specifically so unit
 * tests can supply a fake, the same DI pattern as every other dependency
 * in this codebase. `defaultLocationAndTypeLookup` below is the real,
 * raw-SQL-backed implementation used in production.
 */
export interface LocationAndTypeLookup {
  getLocationChain(locationNodeId: string): Promise<string[]>;
  getPropertyTypeKey(propertyTypeId: string): Promise<string>;
}

export const defaultLocationAndTypeLookup: LocationAndTypeLookup = {
  getLocationChain,
  getPropertyTypeKey,
};

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase.
 */
export function createAiValuationService(
  valuationRepository: ValuationRepository = prismaValuationRepository,
  propertyRepository: PropertyRepository = prismaPropertyRepository,
  statisticalEstimator: StatisticalEstimator = defaultValuationService,
  aiProvider: AIValuationProvider = createAIProvider(),
  timeoutMs: number = env.ai.timeoutMs,
  lookup: LocationAndTypeLookup = defaultLocationAndTypeLookup
) {
  return {
    /**
     * Generates a fresh statistical valuation (via the existing,
     * unmodified `valuationService.estimateValue` — all rate limiting,
     * area resolution, and comparable retrieval is reused, not
     * duplicated) and attempts to enrich it with an AI-generated
     * narrative. On ANY AI failure — provider error, timeout, malformed
     * response — returns the statistical report unchanged with
     * `aiEnriched: false`. Never throws for an AI failure; the
     * statistical result is always the fallback of last resort.
     */
    async generateAiReport(
      propertyId: string,
      context: RequestContext
    ): Promise<AiReportOutcome> {
      const statisticalOutcome = await statisticalEstimator.estimateValue(propertyId, context);

      if (!statisticalOutcome.persisted) {
        return statisticalOutcome;
      }

      const { report } = statisticalOutcome;

      try {
        const property = await propertyRepository.findById(report.propertyId);
        if (!property) {
          // The property existed moments ago (estimateValue just used it)
          // but is now gone — extremely unlikely, but fail soft here too
          // rather than throwing from what should be a resilient path.
          throw new AIProviderError("Property became unavailable during enrichment.");
        }

        const [propertyTypeKey, locationChain] = await Promise.all([
          lookup.getPropertyTypeKey(property.propertyTypeId),
          lookup.getLocationChain(property.locationNodeId),
        ]);

        const stats = extractStatisticalContext(report);

        const narrative = await withTimeout(
          aiProvider.generateNarrative({
            propertyId: property.id,
            estimatedValue: report.estimatedValue,
            lowEstimate: report.lowEstimate,
            highEstimate: report.highEstimate,
            confidenceScore: report.confidenceScore,
            medianComparablePricePerSqm: stats.medianComparablePricePerSqm,
            comparableCount: stats.comparableCount,
            coefficientOfVariation: stats.coefficientOfVariation,
            propertyTypeKey,
            locationChain,
            bedrooms: property.bedrooms,
            buildingAreaSqm: property.buildingAreaSqm,
            landAreaSqm: property.landAreaSqm,
            condition: property.condition,
            currency: "ETB",
          }),
          timeoutMs
        );

        const enrichedReport = await valuationRepository.updateAiEnrichment(report.id, {
          // The interface's own structured output stands in for "the raw
          // AI response" at this layer — the true raw HTTP response (for
          // real providers) is encapsulated inside the provider
          // implementation itself, not exposed through this interface.
          rawAiResponse: { provider: aiProvider.name, output: narrative },
          narrative,
          providerName: aiProvider.name,
        });

        if (!enrichedReport) {
          // Persisted moments ago; this would mean it was deleted in
          // between, which this schema doesn't support (no delete path
          // for ValuationReport) — treat as a fallback rather than throw.
          return {
            persisted: true,
            aiEnriched: false,
            report,
            reason: "Enrichment could not be saved.",
          };
        }

        return { persisted: true, aiEnriched: true, report: enrichedReport };
      } catch (error) {
        // Real failure detail is logged server-side; the client only
        // ever sees a safe, generic-enough reason plus the untouched
        // statistical report — never a 500 for an AI-layer failure.
        console.error("[aiValuationService.generateAiReport] AI enrichment failed:", error);
        const reason =
          error instanceof AIProviderError
            ? error.message
            : "AI narrative generation is temporarily unavailable.";
        return { persisted: true, aiEnriched: false, report, reason };
      }
    },

    /**
     * Reads the cached narrative from an existing report — never
     * triggers a new AI call. Reuses `valuationService.getReport` for
     * not-found/ownership enforcement rather than duplicating that
     * logic — this is purely a shaping layer on top of an existing,
     * already-authorized report fetch. `getReport` throws for
     * not-found/forbidden, so those propagate naturally to the caller.
     */
    async getAiSummary(
      reportId: string,
      context: { userId?: string }
    ): Promise<AiSummaryResult> {
      const report = await statisticalEstimator.getReport(reportId, context);

      const data =
        typeof report.valuationData === "object" && report.valuationData !== null
          ? (report.valuationData as Record<string, unknown>)
          : {};
      const narrative = (data.narrative as NarrativeGenerationOutput | undefined) ?? null;
      const aiProviderName = typeof data.aiProvider === "string" ? data.aiProvider : null;

      return {
        reportId: report.id,
        aiEnriched: narrative !== null,
        narrative,
        aiProvider: aiProviderName,
      };
    },
  };
}

export const aiValuationService = createAiValuationService();
