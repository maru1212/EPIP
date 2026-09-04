/**
 * Route-level tests for Task 8's new endpoints. Mocks the underlying
 * services (and, for the gated B2B routes, `@/lib/auth` +
 * `@/modules/identity/policies`), same pattern as every other
 * route-level test file in this project.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const searchPropertiesMock = vi.fn();
vi.mock("@/modules/search/services/searchService", () => ({
  searchService: { searchProperties: searchPropertiesMock },
}));

const getNeighborhoodStatsMock = vi.fn();
vi.mock("@/modules/search/services/marketDataService", () => ({
  marketDataService: { getNeighborhoodStats: getNeighborhoodStatsMock },
}));

const analyzeListingPriceMock = vi.fn();
const analyzeListingByIdMock = vi.fn();
const analyzeAdHocMock = vi.fn();
vi.mock("@/modules/valuation/services/valuationService", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/valuation/services/valuationService")
  >("@/modules/valuation/services/valuationService");
  return {
    ...actual,
    valuationService: {
      analyzeListingPrice: analyzeListingPriceMock,
      analyzeListingById: analyzeListingByIdMock,
      analyzeAdHoc: analyzeAdHocMock,
    },
  };
});

const findByIdMock = vi.fn();
vi.mock("@/modules/property/repositories/propertyRepository", () => ({
  prismaPropertyRepository: { findById: findByIdMock },
}));

const findLatestByPropertyIdMock = vi.fn();
vi.mock("@/modules/valuation/repositories/valuationRepository", () => ({
  prismaValuationRepository: { findLatestByPropertyId: findLatestByPropertyIdMock },
}));

const { GET: searchGET } = await import("@/app/api/search/properties/route");
const { POST: evaluatePOST } = await import(
  "@/app/api/analytics/evaluate-listing/route"
);
const { GET: valuationSummaryGET } = await import(
  "@/app/api/v1/b2b/properties/[id]/valuation-summary/route"
);
const { GET: neighborhoodStatsGET } = await import(
  "@/app/api/v1/b2b/market-data/neighborhood-stats/route"
);
const { ValuationRateLimitExceededError } = await import(
  "@/modules/valuation/services/valuationService"
);

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  authMock.mockReset();
  canMock.mockReset();
  searchPropertiesMock.mockReset();
  getNeighborhoodStatsMock.mockReset();
  analyzeListingPriceMock.mockReset();
  analyzeListingByIdMock.mockReset();
  analyzeAdHocMock.mockReset();
  findByIdMock.mockReset();
  findLatestByPropertyIdMock.mockReset();
});

describe("GET /api/search/properties", () => {
  it("never checks auth/permissions — it's public", async () => {
    searchPropertiesMock.mockResolvedValue([]);

    const response = await searchGET(new Request("http://localhost/api/search/properties"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("uses the standardized success envelope with pagination meta", async () => {
    searchPropertiesMock.mockResolvedValue([{ listingId: "listing-1" }]);

    const response = await searchGET(
      new Request("http://localhost/api/search/properties?limit=10&offset=0")
    );
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.meta.pagination).toEqual({ limit: 10, offset: 0, count: 1 });
  });

  it("returns a standardized error envelope for invalid params", async () => {
    const response = await searchGET(
      new Request("http://localhost/api/search/properties?minPrice=not-a-number")
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("validation_error");
  });

  it("returns 400 when only some of latitude/longitude/radiusMeters are provided", async () => {
    const response = await searchGET(
      new Request("http://localhost/api/search/properties?latitude=9.01")
    );
    expect(response.status).toBe(400);
    expect(searchPropertiesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/analytics/evaluate-listing", () => {
  it("never checks auth/permissions — it's public", async () => {
    analyzeListingPriceMock.mockResolvedValue({ sufficient: true, assessment: "fairly_priced" });

    const response = await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        propertyId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("routes to analyzeListingPrice for propertyId mode", async () => {
    analyzeListingPriceMock.mockResolvedValue({ sufficient: true, assessment: "fairly_priced" });
    const propertyId = randomUUID();

    await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        propertyId,
        askingPrice: 5_000_000,
      })
    );

    expect(analyzeListingPriceMock).toHaveBeenCalledWith(
      propertyId,
      5_000_000,
      expect.any(Object)
    );
    expect(analyzeListingByIdMock).not.toHaveBeenCalled();
    expect(analyzeAdHocMock).not.toHaveBeenCalled();
  });

  it("routes to analyzeListingById for listingId mode", async () => {
    analyzeListingByIdMock.mockResolvedValue({ sufficient: true, assessment: "fairly_priced" });
    const listingId = randomUUID();

    await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", { listingId })
    );

    expect(analyzeListingByIdMock).toHaveBeenCalledWith(listingId, expect.any(Object));
  });

  it("routes to analyzeAdHoc for direct-parameters mode", async () => {
    analyzeAdHocMock.mockResolvedValue({ sufficient: true, assessment: "fairly_priced" });
    const propertyTypeId = randomUUID();

    await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        latitude: 8.9979,
        longitude: 38.7969,
        buildingSize: 100,
        propertyTypeId,
        askingPrice: 5_000_000,
      })
    );

    expect(analyzeAdHocMock).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 8.9979,
        longitude: 38.7969,
        buildingAreaSqm: 100,
        propertyTypeId,
        askingPrice: 5_000_000,
      }),
      expect.any(Object)
    );
  });

  it("rejects a request with more than one mode specified", async () => {
    const response = await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        propertyId: randomUUID(),
        listingId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects direct-parameters mode missing propertyTypeId", async () => {
    const response = await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        latitude: 8.9979,
        longitude: 38.7969,
        buildingSize: 100,
        askingPrice: 5_000_000,
      })
    );
    expect(response.status).toBe(400);
    expect(analyzeAdHocMock).not.toHaveBeenCalled();
  });

  it("rejects propertyId mode without askingPrice", async () => {
    const response = await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        propertyId: randomUUID(),
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 429 with Retry-After and a standardized error envelope when rate limited", async () => {
    analyzeListingPriceMock.mockRejectedValue(new ValuationRateLimitExceededError(60));

    const response = await evaluatePOST(
      jsonRequest("http://localhost/api/analytics/evaluate-listing", {
        propertyId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("rate_limited");
  });
});

describe("GET /api/v1/b2b/properties/[id]/valuation-summary", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await valuationSummaryGET(
      new Request("http://localhost/api/v1/b2b/properties/prop-1/valuation-summary"),
      routeContext("prop-1")
    );

    expect(response.status).toBe(401);
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking market_data:read", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await valuationSummaryGET(
      new Request("http://localhost/api/v1/b2b/properties/prop-1/valuation-summary"),
      routeContext("prop-1")
    );

    expect(response.status).toBe(403);
    expect(canMock).toHaveBeenCalledWith("user-1", "market_data:read");
  });

  it("returns 404 when the property doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    findByIdMock.mockResolvedValue(null);

    const response = await valuationSummaryGET(
      new Request("http://localhost/api/v1/b2b/properties/prop-1/valuation-summary"),
      routeContext("prop-1")
    );

    expect(response.status).toBe(404);
  });

  it("returns valuation: null when the property has no valuation report yet", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    findByIdMock.mockResolvedValue({ id: "prop-1", locationNodeId: "loc-1" });
    findLatestByPropertyIdMock.mockResolvedValue(null);

    const response = await valuationSummaryGET(
      new Request("http://localhost/api/v1/b2b/properties/prop-1/valuation-summary"),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.valuation).toBeNull();
  });

  it("returns 200 with property and valuation summary for an authorized user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    findByIdMock.mockResolvedValue({ id: "prop-1", locationNodeId: "loc-1" });
    findLatestByPropertyIdMock.mockResolvedValue({
      id: "report-1",
      estimatedValue: 5_000_000,
      confidenceScore: 0.7,
    });

    const response = await valuationSummaryGET(
      new Request("http://localhost/api/v1/b2b/properties/prop-1/valuation-summary"),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.valuation.estimatedValue).toBe(5_000_000);
  });
});

describe("GET /api/v1/b2b/market-data/neighborhood-stats", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await neighborhoodStatsGET(
      new Request(
        `http://localhost/api/v1/b2b/market-data/neighborhood-stats?locationNodeId=${randomUUID()}`
      )
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for a user lacking market_data:read", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await neighborhoodStatsGET(
      new Request(
        `http://localhost/api/v1/b2b/market-data/neighborhood-stats?locationNodeId=${randomUUID()}`
      )
    );

    expect(response.status).toBe(403);
    expect(canMock).toHaveBeenCalledWith("user-1", "market_data:read");
  });

  it("returns 400 for a missing/invalid locationNodeId", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);

    const response = await neighborhoodStatsGET(
      new Request("http://localhost/api/v1/b2b/market-data/neighborhood-stats")
    );

    expect(response.status).toBe(400);
    expect(getNeighborhoodStatsMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent location node", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getNeighborhoodStatsMock.mockResolvedValue(null);

    const response = await neighborhoodStatsGET(
      new Request(
        `http://localhost/api/v1/b2b/market-data/neighborhood-stats?locationNodeId=${randomUUID()}`
      )
    );

    expect(response.status).toBe(404);
  });

  it("returns 200 with the standardized envelope for an authorized user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getNeighborhoodStatsMock.mockResolvedValue({
      locationNodeId: "loc-1",
      includedLocationNodeCount: 3,
      activeListingCount: 5,
      medianPrice: 5_000_000,
      medianPricePerSqm: 50_000,
      priceRange: { min: 4_000_000, max: 6_000_000 },
    });

    const response = await neighborhoodStatsGET(
      new Request(
        `http://localhost/api/v1/b2b/market-data/neighborhood-stats?locationNodeId=${randomUUID()}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.activeListingCount).toBe(5);
  });
});
