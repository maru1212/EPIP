/**
 * Route-level tests proving RBAC enforcement on the listing endpoints,
 * mirroring tests/unit/api/properties-route.test.ts's pattern exactly.
 * Mocks `@/lib/auth` and `@/modules/identity/policies` so these exercise
 * the REAL route handlers and REAL `requirePermission` wiring, with only
 * the session/permission sources faked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const createListingMock = vi.fn();
const updateDetailsMock = vi.fn();
const archiveListingMock = vi.fn();
const updateStatusMock = vi.fn();
const searchMock = vi.fn();
const getPublicListingMock = vi.fn();
const getPricePerSqmMock = vi.fn();

vi.mock("@/modules/listing/services/listingService", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/listing/services/listingService")
  >("@/modules/listing/services/listingService");
  return {
    ...actual,
    listingService: {
      createListing: createListingMock,
      updateDetails: updateDetailsMock,
      archiveListing: archiveListingMock,
      updateStatus: updateStatusMock,
      search: searchMock,
      getPublicListing: getPublicListingMock,
      getPricePerSqm: getPricePerSqmMock,
    },
  };
});

const { GET: listGET, POST } = await import("@/app/api/listings/route");
const { GET: detailGET, PATCH, DELETE } = await import("@/app/api/listings/[id]/route");
const { PATCH: statusPATCH } = await import("@/app/api/listings/[id]/status/route");
const {
  ForbiddenListingActionError,
  ListingNotFoundError,
  InvalidStatusTransitionError,
} = await import("@/modules/listing/services/listingService");

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const validCreateBody = {
  propertyId: randomUUID(),
  listingType: "sale",
  price: 2_000_000,
};

beforeEach(() => {
  authMock.mockReset();
  canMock.mockReset();
  createListingMock.mockReset();
  updateDetailsMock.mockReset();
  archiveListingMock.mockReset();
  updateStatusMock.mockReset();
  searchMock.mockReset();
  getPublicListingMock.mockReset();
  getPricePerSqmMock.mockReset();
});

describe("POST /api/listings (create)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      jsonRequest("http://localhost/api/listings", "POST", validCreateBody)
    );

    expect(response.status).toBe(401);
    expect(canMock).not.toHaveBeenCalled();
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated user lacking listing:create", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await POST(
      jsonRequest("http://localhost/api/listings", "POST", validCreateBody)
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(canMock).toHaveBeenCalledWith("user-1", "listing:create");
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("returns 201 for a user holding listing:create", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);
    createListingMock.mockResolvedValue({ id: "listing-1", ...validCreateBody });

    const response = await POST(
      jsonRequest("http://localhost/api/listings", "POST", validCreateBody)
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("listing-1");
    expect(createListingMock).toHaveBeenCalledWith(
      { ...validCreateBody, currency: "ETB" },
      { userId: "agent-1" }
    );
  });

  it("returns 400 for invalid input from an authorized caller", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);

    const response = await POST(
      jsonRequest("http://localhost/api/listings", "POST", { price: -5 })
    );

    expect(response.status).toBe(400);
    expect(createListingMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/listings (public search)", () => {
  it("never checks auth/permissions — it's public", async () => {
    searchMock.mockResolvedValue([]);

    const response = await listGET(new Request("http://localhost/api/listings"));

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
    expect(canMock).not.toHaveBeenCalled();
  });

  it("returns 400 when only some of latitude/longitude/radiusMeters are provided", async () => {
    const response = await listGET(
      new Request("http://localhost/api/listings?latitude=9.01&longitude=38.79")
    );
    expect(response.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("passes price-range filters through to the service", async () => {
    searchMock.mockResolvedValue([]);

    await listGET(
      new Request("http://localhost/api/listings?minPrice=1000000&maxPrice=5000000")
    );

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: 1_000_000, maxPrice: 5_000_000 })
    );
  });
});

describe("GET /api/listings/[id] (public detail)", () => {
  it("never checks auth/permissions and includes pricePerSqm", async () => {
    getPublicListingMock.mockResolvedValue({ id: "listing-1" });
    getPricePerSqmMock.mockResolvedValue({ perBuildingSqm: 10000, perLandSqm: null });

    const response = await detailGET(
      new Request("http://localhost/api/listings/listing-1"),
      routeContext("listing-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
    expect(body.data.pricePerSqm.perBuildingSqm).toBe(10000);
  });

  it("returns 404 for a draft/nonexistent listing", async () => {
    getPublicListingMock.mockResolvedValue(null);

    const response = await detailGET(
      new Request("http://localhost/api/listings/listing-1"),
      routeContext("listing-1")
    );

    expect(response.status).toBe(404);
    expect(getPricePerSqmMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/listings/[id] (update details)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await PATCH(
      jsonRequest("http://localhost/api/listings/listing-1", "PATCH", { price: 100 }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(401);
    expect(updateDetailsMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking listing:update", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await PATCH(
      jsonRequest("http://localhost/api/listings/listing-1", "PATCH", { price: 100 }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when the service reports the user doesn't own this specific listing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockRejectedValue(new ForbiddenListingActionError());

    const response = await PATCH(
      jsonRequest("http://localhost/api/listings/listing-1", "PATCH", { price: 100 }),
      routeContext("listing-1")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when the listing doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockRejectedValue(new ListingNotFoundError());

    const response = await PATCH(
      jsonRequest("http://localhost/api/listings/listing-1", "PATCH", { price: 100 }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(404);
  });

  it("passes the route's [id] param through correctly", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockResolvedValue({ id: "the-real-id", price: 100 });

    await PATCH(
      jsonRequest("http://localhost/api/listings/the-real-id", "PATCH", { price: 100 }),
      routeContext("the-real-id")
    );

    expect(updateDetailsMock).toHaveBeenCalledWith(
      "the-real-id",
      { price: 100, currency: "ETB" },
      { userId: "user-1" }
    );
  });
});

describe("DELETE /api/listings/[id] (archive)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost/api/listings/listing-1", { method: "DELETE" }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(401);
    expect(archiveListingMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking listing:delete", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await DELETE(
      new Request("http://localhost/api/listings/listing-1", { method: "DELETE" }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(403);
    expect(archiveListingMock).not.toHaveBeenCalled();
  });

  it("returns 200 (archived, not hard-deleted) for an authorized user", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);
    archiveListingMock.mockResolvedValue({ id: "listing-1", status: "archived" });

    const response = await DELETE(
      new Request("http://localhost/api/listings/listing-1", { method: "DELETE" }),
      routeContext("listing-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("archived");
  });
});

describe("PATCH /api/listings/[id]/status", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/listings/listing-1/status", "PATCH", {
        status: "active",
      }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for a user lacking listing:update", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/listings/listing-1/status", "PATCH", {
        status: "active",
      }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 for an invalid status value", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/listings/listing-1/status", "PATCH", {
        status: "not-a-real-status",
      }),
      routeContext("listing-1")
    );

    expect(response.status).toBe(400);
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("returns 409 for an invalid state transition", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateStatusMock.mockRejectedValue(new InvalidStatusTransitionError("archived", "active"));

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/listings/listing-1/status", "PATCH", {
        status: "active",
      }),
      routeContext("listing-1")
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("invalid_transition");
  });

  it("returns 200 for a valid, authorized status transition", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue({ id: "listing-1", status: "active" });

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/listings/listing-1/status", "PATCH", {
        status: "active",
      }),
      routeContext("listing-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("active");
  });
});
