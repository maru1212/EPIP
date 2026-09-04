import { describe, expect, it, vi, afterEach } from "vitest";
import { apiClient, ApiClientError } from "@/lib/api/client";

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient success parsing", () => {
  it("unwraps { success: true, data } and returns just the data", async () => {
    mockFetchOnce({ success: true, data: [{ listingId: "listing-1" }] });

    const result = await apiClient.searchProperties({ locationNodeId: "loc-1" });

    expect(result).toEqual([{ listingId: "listing-1" }]);
  });

  it("builds a query string from provided search params, omitting undefined ones", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient.searchProperties({
      locationNodeId: "loc-1",
      minPrice: 1_000_000,
      maxPrice: undefined,
      listingType: "sale",
    });

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("locationNodeId=loc-1");
    expect(calledUrl).toContain("minPrice=1000000");
    expect(calledUrl).toContain("listingType=sale");
    expect(calledUrl).not.toContain("maxPrice");
  });

  it("sends a POST with a JSON body for evaluateListing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: { sufficient: false, message: "x", comparableCount: 0 },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await apiClient.evaluateListing({ propertyId: "prop-1", askingPrice: 5_000_000 });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/analytics/evaluate-listing");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ propertyId: "prop-1", askingPrice: 5_000_000 });
  });
});

describe("apiClient error parsing", () => {
  it("throws ApiClientError with the server's code/message/status for a { success: false } response", async () => {
    mockFetchOnce(
      { success: false, error: { code: "not_found", message: "Property not found." } },
      404
    );

    await expect(apiClient.getProperty("nonexistent")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "not_found",
      message: "Property not found.",
      status: 404,
    });
  });

  it("includes error details when the server provides them (e.g. validation errors)", async () => {
    mockFetchOnce(
      {
        success: false,
        error: {
          code: "validation_error",
          message: "Invalid input.",
          details: { propertyId: ["Required"] },
        },
      },
      400
    );

    try {
      await apiClient.getProperty("x");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).details).toEqual({ propertyId: ["Required"] });
    }
  });

  it("throws a distinct network_error ApiClientError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiClient.searchProperties()).rejects.toMatchObject({
      name: "ApiClientError",
      code: "network_error",
    });
  });

  it("throws a distinct invalid_response error when the response body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })
    );

    await expect(apiClient.searchProperties()).rejects.toMatchObject({
      name: "ApiClientError",
      code: "invalid_response",
    });
  });
});
