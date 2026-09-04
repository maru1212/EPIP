import { describe, expect, it } from "vitest";

describe("GET /api/openapi.json", () => {
  it("returns a valid OpenAPI 3.0 document, unwrapped (not the standard envelope)", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Deliberately NOT { success, data, ... } — see route file's comment.
    expect(body.success).toBeUndefined();
    expect(body.openapi).toBe("3.0.3");
    expect(body.info).toBeDefined();
    expect(body.info.title).toContain("EPIP");
    expect(body.paths).toBeDefined();
  });

  it("documents every real route added across Tasks 5-8", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const response = await GET();
    const body = await response.json();

    const expectedPaths = [
      "/api/properties",
      "/api/properties/{id}",
      "/api/properties/{id}/status",
      "/api/listings",
      "/api/listings/{id}",
      "/api/listings/{id}/status",
      "/api/valuations/estimate",
      "/api/valuations/analyze-listing",
      "/api/valuations/{id}",
      "/api/search/properties",
      "/api/analytics/evaluate-listing",
      "/api/v1/b2b/properties/{id}/valuation-summary",
      "/api/v1/b2b/market-data/neighborhood-stats",
    ];

    for (const path of expectedPaths) {
      expect(body.paths, `missing path: ${path}`).toHaveProperty(path);
    }
  });

  it("marks gated endpoints with a security requirement and public ones without", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const response = await GET();
    const body = await response.json();

    // Public: no security requirement.
    expect(body.paths["/api/properties"].get.security).toEqual([]);
    expect(body.paths["/api/search/properties"].get.security).toEqual([]);

    // Gated: a bearerAuth requirement present.
    expect(body.paths["/api/properties"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(body.paths["/api/valuations/{id}"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(
      body.paths["/api/v1/b2b/market-data/neighborhood-stats"].get.security
    ).toEqual([{ bearerAuth: [] }]);
  });

  it("declares the standard error status codes on representative endpoints", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const response = await GET();
    const body = await response.json();

    const createProperty = body.paths["/api/properties"].post;
    expect(createProperty.responses).toHaveProperty("400");
    expect(createProperty.responses).toHaveProperty("401");
    expect(createProperty.responses).toHaveProperty("403");

    const estimate = body.paths["/api/valuations/estimate"].post;
    expect(estimate.responses).toHaveProperty("404");
    expect(estimate.responses).toHaveProperty("429");
  });
});

describe("GET /api/docs", () => {
  it("returns an HTML page referencing the OpenAPI spec URL", async () => {
    const { GET } = await import("@/app/api/docs/route");
    const response = await GET();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("/api/openapi.json");
    expect(html.toLowerCase()).toContain("swagger");
  });
});
