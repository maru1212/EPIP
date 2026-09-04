import { PrismaClient } from "@prisma/client";

/**
 * Standard Next.js singleton pattern: avoids creating a new PrismaClient
 * (and a new connection pool) on every hot-reload in development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
