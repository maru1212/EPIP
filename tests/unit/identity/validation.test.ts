import { describe, expect, it } from "vitest";
import { registerSchema, loginSchema } from "@/lib/validation/identity";

describe("registerSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      email: "Test@Example.com",
      password: "a-good-password",
      fullName: "Test User",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // email is normalized: trimmed + lowercased
      expect(result.data.email).toBe("test@example.com");
    }
  });

  it("accepts an optional phone number", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "a-good-password",
      fullName: "Test User",
      phone: "+251911223344",
    });

    expect(result.success).toBe(true);
  });

  it("treats an empty-string phone as absent rather than invalid", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "a-good-password",
      fullName: "Test User",
      phone: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeUndefined();
    }
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "a-good-password",
      fullName: "Test User",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "short",
      fullName: "Test User",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing full name", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "a-good-password",
      fullName: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a valid login payload", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "anything-non-empty",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "anything",
    });

    expect(result.success).toBe(false);
  });
});
