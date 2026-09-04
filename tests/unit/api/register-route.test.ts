import { describe, expect, it, vi, beforeEach } from "vitest";

const registerUserMock = vi.fn();

vi.mock("@/modules/identity/services/authService", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/identity/services/authService")
  >("@/modules/identity/services/authService");
  return {
    ...actual,
    authService: { registerUser: registerUserMock },
  };
});

// Imported after the mock so the route handler picks up the mocked service.
const { POST } = await import("@/app/api/auth/register/route");
const { DuplicateEmailError, RateLimitExceededError } = await import(
  "@/modules/identity/services/authService"
);

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  registerUserMock.mockReset();
});

describe("POST /api/auth/register", () => {
  it("returns 201 and the created user (without the password hash) on success", async () => {
    registerUserMock.mockResolvedValue({
      id: "user-1",
      email: "new@example.com",
      phone: null,
      passwordHash: "$argon2id$...should-never-appear-in-response",
      fullName: "New User",
      status: "active",
      securityVersion: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await POST(
      jsonRequest({
        email: "new@example.com",
        password: "a-good-password",
        fullName: "New User",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user.email).toBe("new@example.com");
    expect(body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("argon2id");
  });

  it("returns 409 when the email is already registered — explicit, by product decision (see docs/authentication-hardening.md §5)", async () => {
    registerUserMock.mockRejectedValue(new DuplicateEmailError());

    const response = await POST(
      jsonRequest({
        email: "taken@example.com",
        password: "a-good-password",
        fullName: "Someone",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate_email");
  });

  it("returns 400 with field-level details for invalid input", async () => {
    const response = await POST(
      jsonRequest({ email: "not-an-email", password: "short", fullName: "" })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("validation_error");
    expect(body.details).toHaveProperty("email");
    expect(body.details).toHaveProperty("password");
    expect(body.details).toHaveProperty("fullName");
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      })
    );

    expect(response.status).toBe(400);
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    registerUserMock.mockRejectedValue(new RateLimitExceededError(42));

    const response = await POST(
      jsonRequest({
        email: "new@example.com",
        password: "a-good-password",
        fullName: "New User",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(body.error).toBe("rate_limited");
  });

  it("returns 500 without leaking internals for an unexpected error", async () => {
    registerUserMock.mockRejectedValue(new Error("something exploded internally"));

    const response = await POST(
      jsonRequest({
        email: "new@example.com",
        password: "a-good-password",
        fullName: "New User",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("exploded");
  });
});

