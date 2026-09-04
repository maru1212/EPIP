import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mocks lib/auth.ts's `auth` and policies.ts's `policyService` — the two
 * things withPermission depends on by default — so this test exercises
 * the REAL route handler (src/app/api/admin/ping/route.ts) and the REAL
 * requirePermission wiring end to end, with only the session/permission
 * sources faked. This is the "protected test endpoint" proving RBAC
 * enforcement per Task 4's acceptance criteria: 403 for a user lacking
 * the permission, success for one with it.
 */
const authMock = vi.fn();
const canMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/modules/identity/policies", () => ({
  policyService: { can: canMock },
}));

const { GET } = await import("@/app/api/admin/ping/route");

beforeEach(() => {
  authMock.mockReset();
  canMock.mockReset();
});

describe("GET /api/admin/ping", () => {
  it("returns 401 when no one is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/ping"));

    expect(response.status).toBe(401);
    expect(canMock).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated user lacking user:manage", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    canMock.mockResolvedValue(false);

    const response = await GET(new Request("http://localhost/api/admin/ping"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("forbidden");
    expect(canMock).toHaveBeenCalledWith("user-1", "user:manage");
  });

  it("returns 200 for a user holding user:manage", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1" } });
    canMock.mockResolvedValue(true);

    const response = await GET(new Request("http://localhost/api/admin/ping"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, userId: "admin-1" });
  });
});
