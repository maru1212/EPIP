import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

// This test only ever exercises createPermissionGuard with fully injected
// dependencies (getSession/can below) — it never uses the real `auth`
// export. Mocking it here avoids eagerly loading the entire next-auth
// chain just to import the type-level shape from lib/auth.ts.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { createPermissionGuard } = await import("@/lib/withPermission");

function fakeSession(userId: string): Session {
  return {
    user: { id: userId },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as Session;
}

describe("createPermissionGuard", () => {
  it("returns 401 when there is no session", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const can = vi.fn();
    const requirePermission = createPermissionGuard({ getSession, can });
    const handler = vi.fn();

    const guarded = requirePermission("property:view", handler);
    const response = await guarded(new Request("http://localhost/api/whatever"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("unauthorized");
    expect(can).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the session exists but lacks the permission", async () => {
    const getSession = vi.fn().mockResolvedValue(fakeSession("user-1"));
    const can = vi.fn().mockResolvedValue(false);
    const requirePermission = createPermissionGuard({ getSession, can });
    const handler = vi.fn();

    const guarded = requirePermission("user:manage", handler);
    const response = await guarded(new Request("http://localhost/api/admin/ping"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("forbidden");
    expect(can).toHaveBeenCalledWith("user-1", "user:manage");
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler and returns its response when the permission is granted", async () => {
    const getSession = vi.fn().mockResolvedValue(fakeSession("user-1"));
    const can = vi.fn().mockResolvedValue(true);
    const requirePermission = createPermissionGuard({ getSession, can });
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const guarded = requirePermission("user:manage", handler);
    const request = new Request("http://localhost/api/admin/ping");
    const response = await guarded(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(request, { userId: "user-1" });
  });

  it("never calls the permission check for an unauthenticated request", async () => {
    // Guards against a regression where `can` might be called with a
    // missing/undefined userId instead of short-circuiting to 401 first.
    const getSession = vi.fn().mockResolvedValue({ user: undefined });
    const can = vi.fn();
    const requirePermission = createPermissionGuard({ getSession, can });

    await requirePermission("property:view", vi.fn())(
      new Request("http://localhost/api/whatever")
    );

    expect(can).not.toHaveBeenCalled();
  });
});
