/**
 * Frontend-owned types mirroring the backend's actual response shapes
 * (there's no shared package between the Next.js app and itself — this
 * project has always kept its API contracts implicit, matched by hand,
 * the same way every route/test pair in this codebase has been built
 * without a generated client). Kept intentionally close to what the
 * routes actually return, not a redesign.
 */

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    pagination?: { limit: number; offset: number; count: number };
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface LocationNode {
  id: string;
  parentId: string | null;
  level: string;
  name: string;
  slug: string;
  centroid: { latitude: number; longitude: number } | null;
}

export interface PropertyType {
  id: string;
  key: string;
  label: string;
  labelAmharic: string | null;
}

export interface PricePerSqm {
  perBuildingSqm: number | null;
  perLandSqm: number | null;
}

/** Matches searchService.DiscoveryResult (GET /api/search/properties). */
export interface DiscoveryResult {
  listingId: string;
  propertyId: string;
  listingType: "sale" | "rent";
  price: number;
  currency: string;
  negotiable: boolean;
  coordinates: { latitude: number; longitude: number } | null;
  buildingAreaSqm: number | null;
  landAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  condition: string | null;
  locationNodeId: string;
  propertyTypeId: string;
  pricePerSqm: PricePerSqm;
}

export interface PropertyDetail {
  id: string;
  locationNodeId: string;
  propertyTypeId: string;
  coordinates: { latitude: number; longitude: number } | null;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  floor: number | null;
  yearBuilt: number | null;
  condition: string | null;
  constructionStatus: string | null;
  displayAddress: string | null;
  landmark: string | null;
  addressDescription: string | null;
  publicationStatus: string;
  verificationStatus: string;
}

export interface ListingRecord {
  id: string;
  propertyId: string;
  agentUserId: string;
  listingType: "sale" | "rent";
  price: number;
  currency: string;
  negotiable: boolean;
  status: string;
  contactInfo: unknown | null;
}

export interface ListingDetailResponse {
  listing: ListingRecord;
  pricePerSqm: PricePerSqm;
}

export type PriceAssessment = "overpriced" | "fairly_priced" | "underpriced";

export type EvaluateListingResult =
  | {
      sufficient: true;
      assessment: PriceAssessment;
      percentageDifference: number;
      askingPricePerSqm: number;
      medianComparablePricePerSqm: number;
      comparableCount: number;
    }
  | { sufficient: false; message: string; comparableCount: 0 };

export interface EvaluateListingByPropertyInput {
  propertyId: string;
  askingPrice: number;
}

export interface EvaluateListingByListingInput {
  listingId: string;
}

export interface EvaluateListingDirectInput {
  latitude: number;
  longitude: number;
  buildingSize: number;
  propertyTypeId: string;
  askingPrice: number;
}

export type EvaluateListingInput =
  | EvaluateListingByPropertyInput
  | EvaluateListingByListingInput
  | EvaluateListingDirectInput;

export interface ValuationReportSummary {
  id: string;
  propertyId: string;
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceScore: number;
  methodology: string;
  createdAt: string;
}

export type EstimateValuationResult =
  | { persisted: true; report: ValuationReportSummary; comparableCount: number }
  | {
      persisted: false;
      aiEnriched: false;
      message: string;
      comparableCount: 0;
    };

export interface NarrativeOutput {
  executiveSummary: string;
  locationAnalysis: string;
  pricingFactors: string;
  confidenceExplanation: string;
}

export interface AiSummaryResult {
  aiEnriched: boolean;
  narrative: NarrativeOutput | null;
  report: ValuationReportSummary;
}

export interface SearchPropertiesParams {
  locationNodeId?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  listingType?: "sale" | "rent";
  minBedrooms?: number;
  minBathrooms?: number;
  minBuildingSize?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  limit?: number;
  offset?: number;
}

export type PropertyCategory = "residential" | "commercial" | "land" | "other";

export interface CategoryStats {
  category: PropertyCategory;
  activeListingCount: number;
  medianPricePerSqm: number | null;
}

/** Matches marketDataService.NeighborhoodStats (Task 12 adds categoryBreakdown/trendDirection). */
export interface NeighborhoodStats {
  locationNodeId: string;
  includedLocationNodeCount: number;
  activeListingCount: number;
  medianPrice: number | null;
  medianPricePerSqm: number | null;
  priceRange: { min: number | null; max: number | null };
  categoryBreakdown: CategoryStats[];
  /** Always "unavailable" today — no PriceHistory data exists yet. See docs/b2b-portal.md. */
  trendDirection: "unavailable";
}

export interface ComparableListingDetail {
  listingId: string;
  propertyId: string;
  displayAddress: string | null;
  areaSqm: number | null;
  price: number;
  pricePerSqm: number | null;
  distanceMeters: number | null;
  condition: string | null;
}

/**
 * The full ValuationReport as returned by GET /api/valuations/[id],
 * including `valuationData`'s statistical detail and (for reports
 * created after Task 12) a `comparables` array — see
 * valuationService.estimateValue and docs/b2b-portal.md. Reports created
 * before this task only have `comparableListingIds` (no per-comparable
 * detail), so `comparables` may legitimately be absent even on an
 * otherwise-complete report.
 */
export interface ValuationReportDetail {
  id: string;
  propertyId: string;
  requestedByUserId: string | null;
  estimatedValue: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceScore: number;
  methodology: string;
  status: string;
  rawAiResponse: unknown | null;
  valuationData: {
    areaType?: "building" | "land";
    targetAreaSqm?: number;
    comparableCount?: number;
    medianPricePerSqm?: number | null;
    coefficientOfVariation?: number | null;
    comparables?: ComparableListingDetail[];
    narrative?: NarrativeOutput;
    aiProvider?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropertyInput {
  locationNodeId: string;
  propertyTypeId: string;
  coordinates?: { latitude: number; longitude: number };
  landAreaSqm?: number;
  buildingAreaSqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  condition?: string;
}

export interface CreatedProperty {
  id: string;
}

export interface GenerateAiReportResult {
  persisted: boolean;
  aiEnriched: boolean;
  report: ValuationReportSummary | null;
  comparableCount: number;
  reason?: string;
}
