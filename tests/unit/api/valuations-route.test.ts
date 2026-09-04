/**
 * Route-level tests for the valuation endpoints. Mocks `@/lib/auth` and
 * `@/modules/identity/policies` (for the gated GET route) and
 * `@/modules/valuation/services/valuationService` (for all three), same
 * pattern as tests/unit/api/properties-route.test.ts and
 * listings-route.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const estimateValueMock = vi.fn();
const analyzeListingPriceMock = vi.fn();
const getReportMock = vi.fn();

vi.mock("@/modules/valuation/services/valuationService", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/valuation/services/valuationService")
  >("@/modules/valuation/services/valuationService");
  return {
    ...actual,
    valuationService: {
      estimateValue: estimateValueMock,
      analyzeListingPrice: analyzeListingPriceMock,
      getReport: getReportMock,
    },
  };
});

const { POST: estimatePOST } = await import("@/app/api/valuations/estimate/route");
const { POST: analyzePOST } = await import("@/app/api/valuations/analyze-listing/route");
const { GET: reportGET } = await import("@/app/api/valuations/[id]/route");
const {
  PropertyNotFoundForValuationError,
  PropertyHasNoUsableAreaError,
  ValuationRateLimitExceededError,
  ValuationReportNotFoundError,
  ForbiddenValuationActionError,
} = await import("@/modules/valuation/services/valuationService");

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
  estimateValueMock.mockReset();
  analyzeListingPriceMock.mockReset();
  getReportMock.mockReset();
});

describe("POST /api/valuations/estimate", () => {
  it("never checks a permission — it's public", async () => {
    authMock.mockResolvedValue(null);
    estimateValueMock.mockResolvedValue({
      persisted: true,
      report: { id: "report-1" },
      comparableCount: 3,
    });

    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(201);
    expect(canMock).not.toHaveBeenCalled();
  });

  it("populates userId only when a session exists, without requiring one", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    estimateValueMock.mockResolvedValue({
      persisted: true,
      report: { id: "report-1" },
      comparableCount: 1,
    });
    const propertyId = randomUUID();

    await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId })
    );

    expect(estimateValueMock).toHaveBeenCalledWith(
      propertyId,
      expect.objectContaining({ userId: "user-1" })
    );
  });

  it("returns 200 with persisted:false for insufficient comparable data (not an error)", async () => {
    authMock.mockResolvedValue(null);
    estimateValueMock.mockResolvedValue({
      persisted: false,
      comparableCount: 0,
      reason: "insufficient_comparable_data",
    });

    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: randomUUID() })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.persisted).toBe(false);
  });

  it("returns 400 for an invalid propertyId", async () => {
    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: "not-a-uuid" })
    );
    expect(response.status).toBe(400);
    expect(estimateValueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the property doesn't exist", async () => {
    authMock.mockResolvedValue(null);
    estimateValueMock.mockRejectedValue(new PropertyNotFoundForValuationError());

    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: randomUUID() })
    );
    expect(response.status).toBe(404);
  });

  it("returns 422 when the property has no usable area", async () => {
    authMock.mockResolvedValue(null);
    estimateValueMock.mockRejectedValue(new PropertyHasNoUsableAreaError());

    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: randomUUID() })
    );
    expect(response.status).toBe(422);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    authMock.mockResolvedValue(null);
    estimateValueMock.mockRejectedValue(new ValuationRateLimitExceededError(30));

    const response = await estimatePOST(
      jsonRequest("http://localhost/api/valuations/estimate", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});

describe("POST /api/valuations/analyze-listing", () => {
  it("never checks auth/permissions — it's public", async () => {
    analyzeListingPriceMock.mockResolvedValue({
      sufficient: true,
      assessment: "fairly_priced",
      percentageDifference: 1.2,
      askingPricePerSqm: 50_000,
      medianComparablePricePerSqm: 49_500,
      comparableCount: 4,
    });

    const response = await analyzePOST(
      jsonRequest("http://localhost/api/valuations/analyze-listing", {
        propertyId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
    expect(canMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-positive askingPrice", async () => {
    const response = await analyzePOST(
      jsonRequest("http://localhost/api/valuations/analyze-listing", {
        propertyId: randomUUID(),
        askingPrice: -100,
      })
    );
    expect(response.status).toBe(400);
    expect(analyzeListingPriceMock).not.toHaveBeenCalled();
  });

  it("returns 200 with sufficient:false for insufficient data", async () => {
    analyzeListingPriceMock.mockResolvedValue({
      sufficient: false,
      comparableCount: 0,
      reason: "insufficient_comparable_data",
    });

    const response = await analyzePOST(
      jsonRequest("http://localhost/api/valuations/analyze-listing", {
        propertyId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sufficient).toBe(false);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    analyzeListingPriceMock.mockRejectedValue(new ValuationRateLimitExceededError(45));

    const response = await analyzePOST(
      jsonRequest("http://localhost/api/valuations/analyze-listing", {
        propertyId: randomUUID(),
        askingPrice: 5_000_000,
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
  });
});

describe("GET /api/valuations/[id]", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await reportGET(
      new Request("http://localhost/api/valuations/report-1"),
      routeContext("report-1")
    );

    expect(response.status).toBe(401);
    expect(canMock).not.toHaveBeenCalled();
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking valuation:view", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await reportGET(
      new Request("http://localhost/api/valuations/report-1"),
      routeContext("report-1")
    );

    expect(response.status).toBe(403);
    expect(canMock).toHaveBeenCalledWith("user-1", "valuation:view");
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the service reports the user doesn't own this specific report", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getReportMock.mockRejectedValue(new ForbiddenValuationActionError());

    const response = await reportGET(
      new Request("http://localhost/api/valuations/report-1"),
      routeContext("report-1")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when the report doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getReportMock.mockRejectedValue(new ValuationReportNotFoundError());

    const response = await reportGET(
      new Request("http://localhost/api/valuations/report-1"),
      routeContext("report-1")
    );

    expect(response.status).toBe(404);
  });

  it("returns 200 with the report for an authorized user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getReportMock.mockResolvedValue({ id: "report-1", estimatedValue: 5_000_000 });

    const response = await reportGET(
      new Request("http://localhost/api/valuations/report-1"),
      routeContext("report-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("report-1");
  });
});
