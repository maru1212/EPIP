/**
 * Domain-level User shape, deliberately independent of the Prisma-generated
 * `User` type. Two reasons:
 *
 * 1. Architectural — services should depend on a domain type, not an ORM's
 *    generated type, so the identity module isn't coupled to Prisma at the
 *    type level (only the repository implementation is).
 * 2. Practical, for this environment specifically — `prisma generate`
 *    cannot run here (see prisma/README.md), so the un-generated
 *    `@prisma/client` stub does not export a `User` type at all. Depending
 *    on it directly would make this module fail to typecheck for a reason
 *    that has nothing to do with the code's correctness.
 */
export type UserStatus = "active" | "suspended" | "pending_verification";

export interface DomainUser {
  id: string;
  email: string;
  phone: string | null;
  passwordHash: string | null;
  fullName: string;
  status: UserStatus;
  securityVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
