import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleUnexpectedError, isPrismaKnownRequestError } from "@/lib/errorBoundary";

function makePrismaError(code: string, message = "Some internal Prisma detail"): unknown {
  return {
    name: "PrismaClientKnownRequestError",
    code,
    clientVersion: "6.19.3",
    message,
    meta: { target: ["email"] },
  };
}

describe("isPrismaKnownRequestError", () => {
  it("recognizes a Prisma-shaped error object", () => {
    expect(isPrismaKnownRequestError(makePrismaError("P2002"))).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isPrismaKnownRequestError(new Error("plain error"))).toBe(false);
  });

  it("rejects null/undefined/primitives without throwing", () => {
    expect(isPrismaKnownRequestError(null)).toBe(false);
    expect(isPrismaKnownRequestError(undefined)).toBe(false);
    expect(isPrismaKnownRequestError("a string")).toBe(false);
    expect(isPrismaKnownRequestError(42)).toBe(false);
  });

  it("rejects an object with the right name but missing code/clientVersion", () => {
    expect(
      isPrismaKnownRequestError({ name: "PrismaClientKnownRequestError" })
    ).toBe(false);
  });
});

describe("handleUnexpectedError", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("maps P2002 (unique constraint) to 409 duplicate_resource", async () => {
    const response = handleUnexpectedError(makePrismaError("P2002"), "TEST /route");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("duplicate_resource");
  });

  it("maps P2025 (not found) to 404 not_found", async () => {
    const response = handleUnexpectedError(makePrismaError("P2025"), "TEST /route");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("maps P2003 (foreign key violation) to 409 conflict", async () => {
    const response = handleUnexpectedError(makePrismaError("P2003"), "TEST /route");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("conflict");
  });

  it("maps an unrecognized Prisma error code to a generic sanitized 500", async () => {
    const response = handleUnexpectedError(makePrismaError("P1017"), "TEST /route");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("database_error");
  });

  it("never leaks the raw Prisma error message into the response, for any code", async () => {
    const secretDetail =
      "connection to server at 10.0.0.5, port 5432 failed: password authentication failed for user 'admin'";
    const response = handleUnexpectedError(
      makePrismaError("P1017", secretDetail),
      "TEST /route"
    );
    const bodyText = await response.text();

    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("10.0.0.5");
    expect(bodyText).not.toContain("password");
  });

  it("returns a generic sanitized 500 for a plain unexpected error, never its .message", async () => {
    const sensitiveError = new Error(
      "Failed query: SELECT * FROM users WHERE ssn = '123-45-6789'"
    );
    const response = handleUnexpectedError(sensitiveError, "TEST /route");
    const bodyText = await response.clone().text();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("internal_error");
    expect(bodyText).not.toContain("123-45-6789");
    expect(bodyText).not.toContain("SELECT");
  });

  it("handles a thrown non-Error value (string, plain object) without crashing", async () => {
    const response1 = handleUnexpectedError("a raw string throw", "TEST /route");
    expect(response1.status).toBe(500);

    const response2 = handleUnexpectedError({ weird: "shape" }, "TEST /route");
    expect(response2.status).toBe(500);
  });

  it("always logs the real error server-side, even though the response is sanitized", () => {
    const realError = new Error("the real, full detail for debugging");
    handleUnexpectedError(realError, "TEST /route");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("TEST /route"),
      realError
    );
  });

  it("returns the standardized error envelope shape", async () => {
    const response = handleUnexpectedError(new Error("anything"), "TEST /route");
    const body = await response.json();

    expect(body).toHaveProperty("success", false);
    expect(body).toHaveProperty("error.code");
    expect(body).toHaveProperty("error.message");
  });
});
