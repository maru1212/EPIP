import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const generateAiReportMock = vi.fn();
const getAiSummaryMock = vi.fn();

vi.mock("@/modules/valuation/services/aiValuationService", () => ({
  aiValuationService: {
    generateAiReport: generateAiReportMock,
    getAiSummary: getAiSummaryMock,
  },
}));

const { POST: aiReportPOST } = await import("@/app/api/valuations/ai-report/route");
const { GET: aiSummaryGET } = await import("@/app/api/valuations/[id]/ai-summary/route");
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
  generateAiReportMock.mockReset();
  getAiSummaryMock.mockReset();
});

describe("POST /api/valuations/ai-report", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(401);
    expect(canMock).not.toHaveBeenCalled();
    expect(generateAiReportMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking valuation:create", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(canMock).toHaveBeenCalledWith("user-1", "valuation:create");
    expect(generateAiReportMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid propertyId", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: "not-a-uuid" })
    );

    expect(response.status).toBe(400);
    expect(generateAiReportMock).not.toHaveBeenCalled();
  });

  it("returns 201 with the standardized envelope when AI enrichment succeeds", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockResolvedValue({
      persisted: true,
      aiEnriched: true,
      report: { id: "report-1", estimatedValue: 5_000_000 },
    });

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.aiEnriched).toBe(true);
  });

  it("returns 200 (not an error) with aiEnriched: false when AI enrichment falls back", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockResolvedValue({
      persisted: true,
      aiEnriched: false,
      report: { id: "report-1", estimatedValue: 5_000_000 },
      reason: "AI provider did not respond within 10000ms.",
    });

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.aiEnriched).toBe(false);
    expect(body.data.report.id).toBe("report-1"); // statistical report still returned
  });

  it("returns 200 with persisted:false for insufficient comparable data", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockResolvedValue({
      persisted: false,
      comparableCount: 0,
      reason: "insufficient_comparable_data",
    });

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.persisted).toBe(false);
    expect(body.data.aiEnriched).toBe(false);
  });

  it("returns 404 when the property doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockRejectedValue(new PropertyNotFoundForValuationError());

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(404);
  });

  it("returns 422 when the property has no usable area", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockRejectedValue(new PropertyHasNoUsableAreaError());

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(422);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    generateAiReportMock.mockRejectedValue(new ValuationRateLimitExceededError(30));

    const response = await aiReportPOST(
      jsonRequest("http://localhost/api/valuations/ai-report", { propertyId: randomUUID() })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});

describe("GET /api/valuations/[id]/ai-summary", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );

    expect(response.status).toBe(401);
    expect(getAiSummaryMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking valuation:view", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );

    expect(response.status).toBe(403);
    expect(canMock).toHaveBeenCalledWith("user-1", "valuation:view");
  });

  it("returns 404 when the report doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getAiSummaryMock.mockRejectedValue(new ValuationReportNotFoundError());

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when the user doesn't own the underlying report", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getAiSummaryMock.mockRejectedValue(new ForbiddenValuationActionError());

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );

    expect(response.status).toBe(403);
  });

  it("returns 200 with aiEnriched: false (not 404) when the report exists but has no narrative", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getAiSummaryMock.mockResolvedValue({
      reportId: "report-1",
      aiEnriched: false,
      narrative: null,
      aiProvider: null,
    });

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.aiEnriched).toBe(false);
  });

  it("returns 200 with the cached narrative when present", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    getAiSummaryMock.mockResolvedValue({
      reportId: "report-1",
      aiEnriched: true,
      narrative: {
        executiveSummary: "s",
        locationAnalysis: "l",
        pricingFactors: "p",
        confidenceExplanation: "c",
      },
      aiProvider: "mock",
    });

    const response = await aiSummaryGET(
      new Request("http://localhost/api/valuations/report-1/ai-summary"),
      routeContext("report-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.aiEnriched).toBe(true);
    expect(body.data.narrative.executiveSummary).toBe("s");
  });
});
