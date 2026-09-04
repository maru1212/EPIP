import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createAuthService,
  InvalidCredentialsError,
  AccountSuspendedError,
  DuplicateEmailError,
  RateLimitExceededError,
} from "@/modules/identity/services/authService";
import * as passwordService from "@/modules/identity/services/passwordService";
import { hashPassword } from "@/modules/identity/services/passwordService";
import { createFakeRateLimiter } from "../../helpers/fakeRateLimiter";
import type {
  CreateUserInput,
  UserRepository,
} from "@/modules/identity/repositories/userRepository";
import type { DomainUser } from "@/modules/identity/types";

const context = { ip: "203.0.113.1" };

/**
 * A minimal in-memory implementation of the repository contract. This is
 * what makes authService fully testable without a database, a generated
 * Prisma Client, or any mocking framework — it's a real (if simple)
 * implementation of the same interface production code depends on.
 */
function createFakeUserRepository(seed: DomainUser[] = []): UserRepository & {
  users: DomainUser[];
} {
  const users = [...seed];
  let nextId = users.length + 1;

  return {
    users,
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },
    async create(input: CreateUserInput) {
      const user: DomainUser = {
        id: `user-${nextId++}`,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        status: input.status,
        securityVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.push(user);
      return user;
    },
    async getSecurityVersion(userId) {
      return users.find((u) => u.id === userId)?.securityVersion ?? null;
    },
    async bumpSecurityVersion(userId) {
      const user = users.find((u) => u.id === userId);
      if (!user) throw new Error("not found");
      user.securityVersion += 1;
      return user.securityVersion;
    },
    async getSecurityStatus(userId) {
      const user = users.find((u) => u.id === userId);
      return user ? { securityVersion: user.securityVersion, status: user.status } : null;
    },
  };
}

describe("authService.registerUser", () => {
  it("creates a new active user with a hashed password, and returns it", async () => {
    const repository = createFakeUserRepository();
    const service = createAuthService(repository, createFakeRateLimiter());

    const returnedUser = await service.registerUser(
      { email: "new@example.com", password: "a-good-password", fullName: "New User" },
      context
    );

    expect(repository.users).toHaveLength(1);
    const user = repository.users[0]!;
    expect(user.email).toBe("new@example.com");
    expect(user.status).toBe("active");
    expect(user.passwordHash).not.toBe("a-good-password");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(returnedUser).toEqual(user);
  });

  it("stores the optional phone number when provided", async () => {
    const repository = createFakeUserRepository();
    const service = createAuthService(repository, createFakeRateLimiter());

    await service.registerUser(
      {
        email: "phone@example.com",
        password: "a-good-password",
        fullName: "Phone User",
        phone: "+251911223344",
      },
      context
    );

    expect(repository.users[0]!.phone).toBe("+251911223344");
  });

  it("rejects registration with an email that already exists (DuplicateEmailError, by product decision — see docs/authentication-hardening.md §5)", async () => {
    const existingHash = await hashPassword("existing-password");
    const repository = createFakeUserRepository([
      {
        id: "user-1",
        email: "taken@example.com",
        phone: null,
        passwordHash: existingHash,
        fullName: "Existing User",
        status: "active",
        securityVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const service = createAuthService(repository, createFakeRateLimiter());

    await expect(
      service.registerUser(
        { email: "taken@example.com", password: "a-different-password", fullName: "New User" },
        context
      )
    ).rejects.toBeInstanceOf(DuplicateEmailError);

    // no second row was created, and the existing row is untouched
    expect(repository.users).toHaveLength(1);
    expect(repository.users[0]!.passwordHash).toBe(existingHash);
  });

  it("does not do the (relatively expensive) password hash for an email that's already taken", async () => {
    const hashSpy = vi.spyOn(passwordService, "hashPassword");
    const repository = createFakeUserRepository([
      {
        id: "user-1",
        email: "taken@example.com",
        phone: null,
        passwordHash: "existing-hash",
        fullName: "Existing User",
        status: "active",
        securityVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const service = createAuthService(repository, createFakeRateLimiter());

    await expect(
      service.registerUser(
        { email: "taken@example.com", password: "a-different-password", fullName: "New User" },
        context
      )
    ).rejects.toBeInstanceOf(DuplicateEmailError);

    expect(hashSpy).not.toHaveBeenCalled();
    hashSpy.mockRestore();
  });

  it("rejects further attempts once the per-IP registration rate limit is hit", async () => {
    const repository = createFakeUserRepository();
    const limiter = createFakeRateLimiter();
    const service = createAuthService(repository, limiter);

    // Exhaust a tiny limit by pre-seeding the fake limiter's counter for
    // this IP's key past what env defaults allow is awkward to reach
    // through real env values in a unit test, so instead we drive the
    // limiter directly to its denial state and confirm authService
    // propagates it.
    const key = `register:ip:${context.ip}`;
    limiter.counts.set(key, 10_000);

    await expect(
      service.registerUser(
        { email: "someone@example.com", password: "a-good-password", fullName: "Someone" },
        context
      )
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    expect(repository.users).toHaveLength(0);
  });
});

describe("authService.verifyCredentials", () => {
  async function repositoryWithUser(overrides: Partial<DomainUser> = {}) {
    const passwordHash = await hashPassword("correct-password");
    return createFakeUserRepository([
      {
        id: "user-1",
        email: "user@example.com",
        phone: null,
        passwordHash,
        fullName: "Test User",
        status: "active",
        securityVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      },
    ]);
  }

  it("returns the user when credentials are correct", async () => {
    const repository = await repositoryWithUser();
    const service = createAuthService(repository, createFakeRateLimiter());

    const user = await service.verifyCredentials("user@example.com", "correct-password", context);
    expect(user.email).toBe("user@example.com");
  });

  it("normalizes email case/whitespace before lookup", async () => {
    const repository = await repositoryWithUser();
    const service = createAuthService(repository, createFakeRateLimiter());

    const user = await service.verifyCredentials(
      "  User@Example.com  ",
      "correct-password",
      context
    );
    expect(user.email).toBe("user@example.com");
  });

  it("rejects an incorrect password", async () => {
    const repository = await repositoryWithUser();
    const service = createAuthService(repository, createFakeRateLimiter());

    await expect(
      service.verifyCredentials("user@example.com", "wrong-password", context)
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects a non-existent email with the SAME error as a wrong password (enumeration protection)", async () => {
    const repository = createFakeUserRepository();
    const service = createAuthService(repository, createFakeRateLimiter());

    await expect(
      service.verifyCredentials("nobody@example.com", "any-password", context)
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects a suspended account even with correct credentials", async () => {
    const repository = await repositoryWithUser({ status: "suspended" });
    const service = createAuthService(repository, createFakeRateLimiter());

    await expect(
      service.verifyCredentials("user@example.com", "correct-password", context)
    ).rejects.toBeInstanceOf(AccountSuspendedError);
  });

  it("rejects further attempts once the per-email login rate limit is hit, even with correct credentials", async () => {
    const repository = await repositoryWithUser();
    const limiter = createFakeRateLimiter();
    limiter.counts.set("login:email:user@example.com", 10_000);
    const service = createAuthService(repository, limiter);

    await expect(
      service.verifyCredentials("user@example.com", "correct-password", context)
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it("rejects further attempts once the per-IP login rate limit is hit, across different emails", async () => {
    const repository = await repositoryWithUser();
    const limiter = createFakeRateLimiter();
    limiter.counts.set(`login:ip:${context.ip}`, 10_000);
    const service = createAuthService(repository, limiter);

    await expect(
      service.verifyCredentials("user@example.com", "correct-password", context)
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});
