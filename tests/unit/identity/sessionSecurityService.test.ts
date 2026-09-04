import { describe, expect, it } from "vitest";
import { createSessionSecurityService } from "@/modules/identity/services/sessionSecurityService";
import type {
  CreateUserInput,
  UserRepository,
} from "@/modules/identity/repositories/userRepository";
import type { DomainUser } from "@/modules/identity/types";

/**
 * Same fake-repository pattern used throughout the identity module's
 * tests — a real (if simple) implementation of the repository contract,
 * not a mock, so this exercises actual logic rather than stubbed calls.
 */
function createFakeUserRepository(seed: DomainUser[] = []): UserRepository & {
  users: DomainUser[];
} {
  const users = [...seed];

  return {
    users,
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },
    async create(input: CreateUserInput) {
      const user: DomainUser = {
        id: `user-${users.length + 1}`,
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

function makeUser(overrides: Partial<DomainUser> = {}): DomainUser {
  return {
    id: "user-1",
    email: "user@example.com",
    phone: null,
    passwordHash: "irrelevant-for-these-tests",
    fullName: "Test User",
    status: "active",
    securityVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("sessionSecurityService.isSessionValid", () => {
  it("is valid when the token's security version matches the current one and the account is active", async () => {
    const repository = createFakeUserRepository([makeUser({ securityVersion: 3 })]);
    const service = createSessionSecurityService(repository);

    const result = await service.isSessionValid("user-1", 3);
    expect(result).toEqual({ valid: true });
  });

  it("is invalid when the token's security version is stale (session was revoked)", async () => {
    const repository = createFakeUserRepository([makeUser({ securityVersion: 3 })]);
    const service = createSessionSecurityService(repository);

    // token embeds version 2, but the user's current version is 3 —
    // meaning revokeAllSessions ran after this token was issued.
    const result = await service.isSessionValid("user-1", 2);
    expect(result).toEqual({ valid: false, reason: "revoked" });
  });

  it("is invalid for a suspended account, even with a matching security version", async () => {
    const repository = createFakeUserRepository([
      makeUser({ securityVersion: 1, status: "suspended" }),
    ]);
    const service = createSessionSecurityService(repository);

    // This is the core "existing session outlives a suspension" scenario:
    // the token's version still matches (nobody explicitly revoked it),
    // but the account is suspended — status alone must be enough to reject.
    const result = await service.isSessionValid("user-1", 1);
    expect(result).toEqual({ valid: false, reason: "suspended" });
  });

  it("is invalid when the user no longer exists", async () => {
    const repository = createFakeUserRepository();
    const service = createSessionSecurityService(repository);

    const result = await service.isSessionValid("nonexistent-user", 1);
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });
});

describe("sessionSecurityService.revokeAllSessions", () => {
  it("increments the user's security version", async () => {
    const repository = createFakeUserRepository([makeUser({ securityVersion: 1 })]);
    const service = createSessionSecurityService(repository);

    const newVersion = await service.revokeAllSessions("user-1");
    expect(newVersion).toBe(2);
  });

  it("makes a previously-valid token invalid immediately after revocation", async () => {
    const repository = createFakeUserRepository([makeUser({ securityVersion: 1 })]);
    const service = createSessionSecurityService(repository);

    // A token issued before revocation embeds version 1.
    expect((await service.isSessionValid("user-1", 1)).valid).toBe(true);

    await service.revokeAllSessions("user-1");

    // The same token (still embedding version 1) is now rejected, without
    // needing to touch the token itself — this is the whole point of the
    // mechanism.
    const result = await service.isSessionValid("user-1", 1);
    expect(result).toEqual({ valid: false, reason: "revoked" });
  });
});
