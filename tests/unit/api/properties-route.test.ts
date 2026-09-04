/**
 * Route-level tests proving RBAC enforcement on the property endpoints,
 * per Task 5's explicit requirement: "unauthorized access returns
 * 401/403 cleanly using our established withPermission/requirePermission
 * patterns." Mocks `@/lib/auth` and `@/modules/identity/policies` (the
 * two things `requirePermission` depends on by default) so these
 * exercise the REAL route handlers and REAL `requirePermission` wiring,
 * with only the session/permission sources faked — same pattern as
 * tests/unit/api/admin-ping-route.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const createPropertyMock = vi.fn();
const updateDetailsMock = vi.fn();
const archivePropertyMock = vi.fn();
const updatePublicationStatusMock = vi.fn();
const searchMock = vi.fn();
const getPublishedPropertyMock = vi.fn();

vi.mock("@/modules/property/services/propertyService", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/property/services/propertyService")
  >("@/modules/property/services/propertyService");
  return {
    ...actual,
    propertyService: {
      createProperty: createPropertyMock,
      updateDetails: updateDetailsMock,
      archiveProperty: archivePropertyMock,
      updatePublicationStatus: updatePublicationStatusMock,
      search: searchMock,
      getPublishedProperty: getPublishedPropertyMock,
    },
  };
});

const { GET: listGET, POST } = await import("@/app/api/properties/route");
const { PATCH, DELETE } = await import("@/app/api/properties/[id]/route");
const { PATCH: statusPATCH } = await import("@/app/api/properties/[id]/status/route");
const { ForbiddenPropertyActionError, PropertyNotFoundError } = await import(
  "@/modules/property/services/propertyService"
);

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
  locationNodeId: randomUUID(),
  propertyTypeId: randomUUID(),
  bedrooms: 3,
};

beforeEach(() => {
  authMock.mockReset();
  canMock.mockReset();
  createPropertyMock.mockReset();
  updateDetailsMock.mockReset();
  archivePropertyMock.mockReset();
  updatePublicationStatusMock.mockReset();
  searchMock.mockReset();
  getPublishedPropertyMock.mockReset();
});

describe("POST /api/properties (create)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      jsonRequest("http://localhost/api/properties", "POST", validCreateBody)
    );

    expect(response.status).toBe(401);
    expect(canMock).not.toHaveBeenCalled();
    expect(createPropertyMock).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated user lacking property:create", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await POST(
      jsonRequest("http://localhost/api/properties", "POST", validCreateBody)
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(canMock).toHaveBeenCalledWith("user-1", "property:create");
    expect(createPropertyMock).not.toHaveBeenCalled();
  });

  it("returns 201 for a user holding property:create", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);
    createPropertyMock.mockResolvedValue({ id: "prop-1", ...validCreateBody });

    const response = await POST(
      jsonRequest("http://localhost/api/properties", "POST", validCreateBody)
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("prop-1");
    expect(createPropertyMock).toHaveBeenCalledWith(validCreateBody, { userId: "agent-1" });
  });

  it("returns 400 for invalid input from an authorized caller, without reaching the service", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);

    const response = await POST(
      jsonRequest("http://localhost/api/properties", "POST", { bedrooms: "not-a-uuid" })
    );

    expect(response.status).toBe(400);
    expect(createPropertyMock).not.toHaveBeenCalled();
  });

  it("sanitizes a Prisma-shaped unique-constraint error into the standardized 409 envelope, leaking nothing internal", async () => {
    authMock.mockResolvedValue({ user: { id: "agent-1" } });
    canMock.mockResolvedValue(true);
    // Shaped exactly like a real PrismaClientKnownRequestError (see
    // src/lib/errorBoundary.ts's duck-typing) — this is what a real
    // unique-constraint violation from the database would surface as.
    createPropertyMock.mockRejectedValue({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "6.19.3",
      message:
        "Unique constraint failed on fields: (`email`) — connection: postgres://epip:supersecret@10.0.0.5:5432/epip_dev",
    });

    const response = await POST(
      jsonRequest("http://localhost/api/properties", "POST", validCreateBody)
    );
    const bodyText = await response.clone().text();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("duplicate_resource");
    // The real error's connection string/credentials must never reach
    // the client, even though they were present on the thrown object.
    expect(bodyText).not.toContain("supersecret");
    expect(bodyText).not.toContain("10.0.0.5");
    expect(bodyText).not.toContain("postgres://");
  });
});

describe("GET /api/properties (public search)", () => {
  it("never checks auth/permissions — it's public", async () => {
    searchMock.mockResolvedValue([]);

    const response = await listGET(new Request("http://localhost/api/properties"));

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
    expect(canMock).not.toHaveBeenCalled();
  });

  it("returns 400 when only some of latitude/longitude/radiusMeters are provided", async () => {
    const response = await listGET(
      new Request("http://localhost/api/properties?latitude=9.01")
    );
    expect(response.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/properties/[id] (public detail)", () => {
  it("never checks auth/permissions — it's public", async () => {
    getPublishedPropertyMock.mockResolvedValue({ id: "prop-1" });

    const { GET } = await import("@/app/api/properties/[id]/route");
    const response = await GET(
      new Request("http://localhost/api/properties/prop-1"),
      routeContext("prop-1")
    );

    expect(response.status).toBe(200);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a draft/nonexistent property", async () => {
    getPublishedPropertyMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/properties/[id]/route");
    const response = await GET(
      new Request("http://localhost/api/properties/prop-1"),
      routeContext("prop-1")
    );

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/properties/[id] (update details)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await PATCH(
      jsonRequest("http://localhost/api/properties/prop-1", "PATCH", { bedrooms: 4 }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(401);
    expect(updateDetailsMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking property:update", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await PATCH(
      jsonRequest("http://localhost/api/properties/prop-1", "PATCH", { bedrooms: 4 }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(403);
    expect(updateDetailsMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the service reports the user doesn't own this specific property (resource-level, distinct from the route-level permission check)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true); // holds property:update in general
    updateDetailsMock.mockRejectedValue(new ForbiddenPropertyActionError());

    const response = await PATCH(
      jsonRequest("http://localhost/api/properties/prop-1", "PATCH", { bedrooms: 4 }),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 when the property doesn't exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockRejectedValue(new PropertyNotFoundError());

    const response = await PATCH(
      jsonRequest("http://localhost/api/properties/prop-1", "PATCH", { bedrooms: 4 }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(404);
  });

  it("passes the route's [id] param through correctly (the withPermission param-forwarding fix)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockResolvedValue({ id: "the-real-id", bedrooms: 4 });

    await PATCH(
      jsonRequest("http://localhost/api/properties/the-real-id", "PATCH", { bedrooms: 4 }),
      routeContext("the-real-id")
    );

    expect(updateDetailsMock).toHaveBeenCalledWith(
      "the-real-id",
      { bedrooms: 4 },
      { userId: "user-1" }
    );
  });

  it("returns 200 with the updated property for an authorized owner", async () => {
    authMock.mockResolvedValue({ user: { id: "owner-1" } });
    canMock.mockResolvedValue(true);
    updateDetailsMock.mockResolvedValue({ id: "prop-1", bedrooms: 4 });

    const response = await PATCH(
      jsonRequest("http://localhost/api/properties/prop-1", "PATCH", { bedrooms: 4 }),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.bedrooms).toBe(4);
  });
});

describe("DELETE /api/properties/[id] (archive)", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost/api/properties/prop-1", { method: "DELETE" }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(401);
    expect(archivePropertyMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a user lacking property:delete", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await DELETE(
      new Request("http://localhost/api/properties/prop-1", { method: "DELETE" }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(403);
    expect(archivePropertyMock).not.toHaveBeenCalled();
  });

  it("returns 200 (archived, not hard-deleted) for an authorized user", async () => {
    authMock.mockResolvedValue({ user: { id: "owner-1" } });
    canMock.mockResolvedValue(true);
    archivePropertyMock.mockResolvedValue({ id: "prop-1", publicationStatus: "archived" });

    const response = await DELETE(
      new Request("http://localhost/api/properties/prop-1", { method: "DELETE" }),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.publicationStatus).toBe("archived");
  });
});

describe("PATCH /api/properties/[id]/status", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/properties/prop-1/status", "PATCH", {
        publicationStatus: "published",
      }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for a user lacking property:update", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/properties/prop-1/status", "PATCH", {
        publicationStatus: "published",
      }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 for an invalid status value", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(true);

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/properties/prop-1/status", "PATCH", {
        publicationStatus: "not-a-real-status",
      }),
      routeContext("prop-1")
    );

    expect(response.status).toBe(400);
    expect(updatePublicationStatusMock).not.toHaveBeenCalled();
  });

  it("returns 200 for an authorized status transition", async () => {
    authMock.mockResolvedValue({ user: { id: "owner-1" } });
    canMock.mockResolvedValue(true);
    updatePublicationStatusMock.mockResolvedValue({
      id: "prop-1",
      publicationStatus: "published",
    });

    const response = await statusPATCH(
      jsonRequest("http://localhost/api/properties/prop-1/status", "PATCH", {
        publicationStatus: "published",
      }),
      routeContext("prop-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.publicationStatus).toBe("published");
  });
});
