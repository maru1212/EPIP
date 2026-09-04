import {
  prismaValuationRepository,
  type ValuationRepository,
  type ValuationReportRecord,
  type ComparableListing,
} from "../repositories/valuationRepository";
import {
  prismaPropertyRepository,
  type PropertyRepository,
  type PropertyRecord,
} from "@/modules/property/repositories/propertyRepository";
import {
  prismaListingRepository,
  type ListingRepository,
} from "@/modules/listing/repositories/listingRepository";
import { policyService } from "@/modules/identity/policies";
import {
  computeValuationEstimate,
  analyzeAskingPrice as analyzeAskingPriceMath,
  type ComputeValuationOutcome,
  type AnalyzeAskingPriceOutcome,
} from "./valuationMath";
import type { RateLimiter } from "@/lib/rate-limit/rateLimiter";
import { postgresRateLimiter } from "@/lib/rate-limit/postgresRateLimiter";
import { checkAndConsume } from "@/lib/rate-limit/checkAndConsume";
import { env } from "@/lib/env";

export class PropertyNotFoundForValuationError extends Error {
  constructor() {
    super("The property to be valued does not exist.");
    this.name = "PropertyNotFoundForValuationError";
  }
}

export class ListingNotFoundForValuationError extends Error {
  constructor() {
    super("The listing to be evaluated does not exist.");
    this.name = "ListingNotFoundForValuationError";
  }
}

export class PropertyHasNoUsableAreaError extends Error {
  constructor() {
    super(
      "This property has no recorded building or land area, so it cannot be valued."
    );
    this.name = "PropertyHasNoUsableAreaError";
  }
}

export class ValuationReportNotFoundError extends Error {
  constructor() {
    super("Valuation report not found.");
    this.name = "ValuationReportNotFoundError";
  }
}

export class ForbiddenValuationActionError extends Error {
  constructor() {
    super("You do not have permission to view this valuation report.");
    this.name = "ForbiddenValuationActionError";
  }
}

export class ValuationRateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many valuation requests. Please try again later.");
    this.name = "ValuationRateLimitExceededError";
  }
}

/** Default search radius when the target property has coordinates. */
const DEFAULT_COMPARABLE_RADIUS_METERS = 3000;
const MAX_COMPARABLES = 30;

export interface RequestContext {
  /** Present only for an authenticated caller — see docs/valuation-domain.md §2. */
  userId?: string;
  ip: string;
}

export type EstimateOutcome =
  | { persisted: true; report: ValuationReportRecord; comparableCount: number }
  | { persisted: false; comparableCount: 0; reason: "insufficient_comparable_data" };

export type AnalysisOutcome =
  | ({ sufficient: true } & Extract<AnalyzeAskingPriceOutcome, { sufficient: true }>)
  | { sufficient: false; comparableCount: 0; reason: "insufficient_comparable_data" };

/**
 * Determines which area field (building or land) a property should be
 * valued by. Building area is preferred when present (the more common,
 * more informative case for houses/apartments); falls back to land area
 * for property types where that's the only meaningful figure (e.g. bare
 * land). Returns null if neither is usable — that property cannot be
 * valued by this method at all.
 */
function resolveAreaType(
  property: Pick<PropertyRecord, "buildingAreaSqm" | "landAreaSqm">
): { areaType: "building" | "land"; targetAreaSqm: number } | null {
  if (property.buildingAreaSqm !== null && property.buildingAreaSqm > 0) {
    return { areaType: "building", targetAreaSqm: property.buildingAreaSqm };
  }
  if (property.landAreaSqm !== null && property.landAreaSqm > 0) {
    return { areaType: "land", targetAreaSqm: property.landAreaSqm };
  }
  return null;
}

function comparablePricePerSqm(
  comparable: ComparableListing,
  areaType: "building" | "land"
): number | null {
  const area = areaType === "building" ? comparable.buildingAreaSqm : comparable.landAreaSqm;
  return area !== null && area > 0 ? comparable.price / area : null;
}

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase. `canViewAnyReport` mirrors property/listingService's
 * admin-override proxy: defaults to `user:manage`, the same flagged,
 * interim compromise (see docs/valuation-domain.md §2).
 */
export function createValuationService(
  valuationRepository: ValuationRepository = prismaValuationRepository,
  propertyRepository: PropertyRepository = prismaPropertyRepository,
  rateLimiter: RateLimiter = postgresRateLimiter,
  canViewAnyReport: (userId: string) => Promise<boolean> = (userId) =>
    policyService.can(userId, "user:manage"),
  listingRepository: ListingRepository = prismaListingRepository
) {
  async function fetchComparablePricesPerSqm(
    params: {
      propertyTypeId: string;
      excludePropertyId?: string;
      locationNodeId?: string;
      coordinates?: { latitude: number; longitude: number } | null;
    },
    areaType: "building" | "land"
  ): Promise<{ comparables: ComparableListing[]; pricesPerSqm: number[] }> {
    const comparables = await valuationRepository.findComparableListings({
      propertyTypeId: params.propertyTypeId,
      excludePropertyId: params.excludePropertyId,
      locationNodeId: params.locationNodeId,
      near: params.coordinates
        ? { center: params.coordinates, radiusMeters: DEFAULT_COMPARABLE_RADIUS_METERS }
        : undefined,
      areaType,
      limit: MAX_COMPARABLES,
    });

    const pricesPerSqm = comparables
      .map((c) => comparablePricePerSqm(c, areaType))
      .filter((p): p is number => p !== null);

    return { comparables, pricesPerSqm };
  }

  return {
    /**
     * Generates (and, unless data is insufficient, persists) an automated
     * valuation estimate. Public/rate-limited by design — see
     * docs/valuation-domain.md §2 — `context.userId` is populated only
     * for authenticated callers and is never required.
     */
    async estimateValue(
      propertyId: string,
      context: RequestContext
    ): Promise<EstimateOutcome> {
      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `valuation:estimate:ip:${context.ip}`,
          max: env.rateLimit.valuationPerIp.max,
          windowSeconds: env.rateLimit.valuationPerIp.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new ValuationRateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const property = await propertyRepository.findById(propertyId);
      if (!property) {
        throw new PropertyNotFoundForValuationError();
      }

      const areaInfo = resolveAreaType(property);
      if (!areaInfo) {
        throw new PropertyHasNoUsableAreaError();
      }

      const { comparables, pricesPerSqm } = await fetchComparablePricesPerSqm(
        {
          propertyTypeId: property.propertyTypeId,
          excludePropertyId: property.id,
          locationNodeId: property.locationNodeId,
          coordinates: property.coordinates,
        },
        areaInfo.areaType
      );

      const outcome: ComputeValuationOutcome = computeValuationEstimate({
        comparablePricesPerSqm: pricesPerSqm,
        targetAreaSqm: areaInfo.targetAreaSqm,
        condition: property.condition,
      });

      if (!outcome.sufficient) {
        // Deliberately not persisted — see valuationMath.ts and
        // docs/valuation-domain.md §1 for why a zero-comparable case
        // returns "insufficient data" rather than a fabricated number.
        return {
          persisted: false,
          comparableCount: 0,
          reason: "insufficient_comparable_data",
        };
      }

      const report = await valuationRepository.createReport({
        propertyId: property.id,
        requestedByUserId: context.userId ?? null,
        estimatedValue: outcome.estimatedValue,
        lowEstimate: outcome.lowEstimate,
        highEstimate: outcome.highEstimate,
        confidenceScore: outcome.confidenceScore,
        methodology: "comparable_sales",
        valuationData: {
          areaType: areaInfo.areaType,
          targetAreaSqm: areaInfo.targetAreaSqm,
          comparableListingIds: comparables.map((c) => c.listingId),
          comparableCount: outcome.comparableCount,
          medianPricePerSqm: outcome.medianPricePerSqm,
          averagePricePerSqm: outcome.averagePricePerSqm,
          coefficientOfVariation: outcome.coefficientOfVariation,
          conditionMultiplierApplied: outcome.conditionMultiplierApplied,
          // Task 12's B2B report viewer needs enough per-comparable
          // detail to render a real table (address, size, price,
          // price/m2, distance) — the bare `comparableListingIds` above
          // predates that need and is kept for backward compatibility
          // with anything already reading it. computePricePerSqm mirrors
          // valuationMath's own building-vs-land logic so the displayed
          // per-comparable figure is calculated the same way the
          // aggregate statistics were.
          comparables: comparables.map((c) => {
            const areaSqm = areaInfo.areaType === "building" ? c.buildingAreaSqm : c.landAreaSqm;
            return {
              listingId: c.listingId,
              propertyId: c.propertyId,
              displayAddress: c.displayAddress,
              areaSqm,
              price: c.price,
              pricePerSqm: areaSqm !== null && areaSqm > 0 ? c.price / areaSqm : null,
              distanceMeters: c.distanceMeters,
              condition: c.condition,
            };
          }),
        },
      });

      return { persisted: true, report, comparableCount: outcome.comparableCount };
    },

    /**
     * The "is this overpriced?" analyzer. Stateless — no ValuationReport
     * is created, per docs/valuation-domain.md §3 (this is a query, not a
     * saved report). Public/rate-limited, same as estimateValue.
     */
    async analyzeListingPrice(
      propertyId: string,
      askingPrice: number,
      context: RequestContext
    ): Promise<AnalysisOutcome> {
      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `valuation:analyze:ip:${context.ip}`,
          max: env.rateLimit.valuationPerIp.max,
          windowSeconds: env.rateLimit.valuationPerIp.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new ValuationRateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const property = await propertyRepository.findById(propertyId);
      if (!property) {
        throw new PropertyNotFoundForValuationError();
      }

      const areaInfo = resolveAreaType(property);
      if (!areaInfo) {
        throw new PropertyHasNoUsableAreaError();
      }

      const { pricesPerSqm } = await fetchComparablePricesPerSqm(
        {
          propertyTypeId: property.propertyTypeId,
          excludePropertyId: property.id,
          locationNodeId: property.locationNodeId,
          coordinates: property.coordinates,
        },
        areaInfo.areaType
      );

      const outcome = analyzeAskingPriceMath({
        askingPrice,
        targetAreaSqm: areaInfo.targetAreaSqm,
        comparablePricesPerSqm: pricesPerSqm,
      });

      if (!outcome.sufficient) {
        return {
          sufficient: false,
          comparableCount: 0,
          reason: "insufficient_comparable_data",
        };
      }

      return outcome;
    },

    /**
     * The "listingId" mode of POST /api/analytics/evaluate-listing (Task
     * 8): resolves a real Listing to its Property and price, then runs
     * the same comparable-based analysis as `analyzeListingPrice`. The
     * listing's own price is used as the asking price unless the caller
     * explicitly overrides it (e.g. "what if this were priced at X
     * instead") — matching the spec's framing of listingId as one of
     * several ways to specify what's being evaluated, not a fixed,
     * unchangeable input.
     */
    async analyzeListingById(
      listingId: string,
      context: RequestContext,
      askingPriceOverride?: number
    ): Promise<AnalysisOutcome> {
      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `valuation:analyze:ip:${context.ip}`,
          max: env.rateLimit.valuationPerIp.max,
          windowSeconds: env.rateLimit.valuationPerIp.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new ValuationRateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const listing = await listingRepository.findById(listingId);
      if (!listing) {
        throw new ListingNotFoundForValuationError();
      }

      const property = await propertyRepository.findById(listing.propertyId);
      if (!property) {
        throw new PropertyNotFoundForValuationError();
      }

      const areaInfo = resolveAreaType(property);
      if (!areaInfo) {
        throw new PropertyHasNoUsableAreaError();
      }

      const { pricesPerSqm } = await fetchComparablePricesPerSqm(
        {
          propertyTypeId: property.propertyTypeId,
          excludePropertyId: property.id,
          locationNodeId: property.locationNodeId,
          coordinates: property.coordinates,
        },
        areaInfo.areaType
      );

      const outcome = analyzeAskingPriceMath({
        askingPrice: askingPriceOverride ?? listing.price,
        targetAreaSqm: areaInfo.targetAreaSqm,
        comparablePricesPerSqm: pricesPerSqm,
      });

      if (!outcome.sufficient) {
        return {
          sufficient: false,
          comparableCount: 0,
          reason: "insufficient_comparable_data",
        };
      }

      return outcome;
    },

    /**
     * The "direct parameters" mode of POST /api/analytics/evaluate-listing
     * (Task 8): analyzes an asking price against comparable listings near
     * a raw lat/lon point, with no existing Property row required. Adds
     * `propertyTypeId` as a genuinely required input beyond the Task 8
     * spec's literal "location, buildingSize, askingPrice" list — Task
     * 7's comparable-matching is built around "same property type,"
     * and matching without one would mean comparing, say, an apartment
     * against a warehouse. See docs/search-and-b2b-domain.md.
     */
    async analyzeAdHoc(
      params: {
        latitude: number;
        longitude: number;
        buildingAreaSqm: number;
        propertyTypeId: string;
        askingPrice: number;
      },
      context: RequestContext
    ): Promise<AnalysisOutcome> {
      const rateLimitResult = await checkAndConsume(rateLimiter, [
        {
          key: `valuation:analyze:ip:${context.ip}`,
          max: env.rateLimit.valuationPerIp.max,
          windowSeconds: env.rateLimit.valuationPerIp.windowSeconds,
        },
      ]);
      if (!rateLimitResult.allowed) {
        throw new ValuationRateLimitExceededError(rateLimitResult.retryAfterSeconds!);
      }

      const { pricesPerSqm } = await fetchComparablePricesPerSqm(
        {
          propertyTypeId: params.propertyTypeId,
          coordinates: { latitude: params.latitude, longitude: params.longitude },
          // No `excludePropertyId` or `locationNodeId` — there is no saved
          // Property to exclude, and no LocationNode reference in this
          // mode, so matching is spatial-only. A real documented
          // limitation of this mode (see docs/search-and-b2b-domain.md).
        },
        "building"
      );

      const outcome = analyzeAskingPriceMath({
        askingPrice: params.askingPrice,
        targetAreaSqm: params.buildingAreaSqm,
        comparablePricesPerSqm: pricesPerSqm,
      });

      if (!outcome.sufficient) {
        return {
          sufficient: false,
          comparableCount: 0,
          reason: "insufficient_comparable_data",
        };
      }

      return outcome;
    },

    /**
     * Fetches a saved report. Gated behind `valuation:view` at the route
     * level (unlike Property/Listing's public GETs — see
     * docs/valuation-domain.md §2 for why). Additionally enforces
     * ownership here, same pattern as property/listingService: the
     * report's requester (if any) or an admin-override may view it; a
     * report with no requester (an anonymous estimate) is viewable by
     * anyone already holding the base `valuation:view` permission.
     *
     * Takes only `userId` (not the full `RequestContext`) — this
     * operation doesn't rate-limit or otherwise need an IP address, and
     * requiring one here would force every caller to pass a meaningless
     * placeholder.
     */
    async getReport(
      id: string,
      context: { userId?: string }
    ): Promise<ValuationReportRecord> {
      const report = await valuationRepository.findById(id);
      if (!report) {
        throw new ValuationReportNotFoundError();
      }

      if (report.requestedByUserId !== null && report.requestedByUserId !== context.userId) {
        const isAdmin = context.userId ? await canViewAnyReport(context.userId) : false;
        if (!isAdmin) {
          throw new ForbiddenValuationActionError();
        }
      }

      return report;
    },
  };
}

export const valuationService = createValuationService();
