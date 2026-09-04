import { prisma } from "@/lib/db";
import type { DomainUser, UserStatus } from "../types";

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string | null;
  status: UserStatus;
}

/**
 * Repository contract for the identity module's persistence needs. Kept
 * narrow — only what authService actually needs — rather than a generic
 * "UserRepository does everything" interface.
 *
 * Defining this as an interface (rather than importing the Prisma-backed
 * implementation directly everywhere) is what lets authService be unit
 * tested with an in-memory fake, with no database involved.
 */
export interface UserRepository {
  findByEmail(email: string): Promise<DomainUser | null>;
  create(input: CreateUserInput): Promise<DomainUser>;
  /** Returns null if the user no longer exists. */
  getSecurityVersion(userId: string): Promise<number | null>;
  /**
   * Atomically increments the user's security_version. Every JWT issued
   * before this call embeds the old value and will be rejected on its next
   * check (see sessionSecurityService). Returns the new value.
   */
  bumpSecurityVersion(userId: string): Promise<number>;
  /**
   * Combined lookup for session validation: needs both the current
   * security_version (to detect revocation) and status (to catch a
   * suspension even if something failed to bump the version) in a single
   * query, since both are checked on every validated-session read.
   */
  getSecurityStatus(
    userId: string
  ): Promise<{ securityVersion: number; status: UserStatus } | null>;
}

/**
 * Maps a raw Prisma `User` row to the module's domain type. Written
 * explicitly (rather than passing the Prisma row through as-is) so the
 * seam between "whatever Prisma returns" and "what this module depends on"
 * is visible in one place.
 *
 * Note: because `prisma generate` cannot run in the environment this was
 * written in (see prisma/README.md), the un-generated `@prisma/client`
 * stub types `PrismaClient` — and therefore every query result — as `any`.
 * This function is written against the shape `schema.prisma` defines, but
 * that shape cannot be enforced by the type checker here. It should be
 * re-verified once `prisma generate` can run against this schema.
 */
function toDomainUser(row: {
  id: string;
  email: string;
  phone: string | null;
  passwordHash: string | null;
  fullName: string;
  status: string;
  securityVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): DomainUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    status: row.status as UserStatus,
    securityVersion: row.securityVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const prismaUserRepository: UserRepository = {
  async findByEmail(email) {
    const row = await prisma.user.findUnique({ where: { email } });
    return row ? toDomainUser(row) : null;
  },

  async create(input) {
    const row = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        phone: input.phone ?? null,
        status: input.status,
      },
    });
    return toDomainUser(row);
  },

  async getSecurityVersion(userId) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { securityVersion: true },
    });
    return row ? row.securityVersion : null;
  },

  async bumpSecurityVersion(userId) {
    const row = await prisma.user.update({
      where: { id: userId },
      data: { securityVersion: { increment: 1 } },
      select: { securityVersion: true },
    });
    return row.securityVersion;
  },

  async getSecurityStatus(userId) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { securityVersion: true, status: true },
    });
    return row ? { securityVersion: row.securityVersion, status: row.status as UserStatus } : null;
  },
};
