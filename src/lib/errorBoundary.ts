import { errorResponse } from "./apiResponse";
import type { ApiErrorOptions } from "./apiResponse";
import { NextResponse } from "next/server";

/**
 * Duck-typed, not `instanceof Prisma.PrismaClientKnownRequestError`.
 * Two reasons, not just one:
 *
 * 1. In this sandbox, `Prisma.PrismaClientKnownRequestError` is `undefined`
 *    at runtime — the un-generated Prisma Client stub (see
 *    prisma/README.md) doesn't expose it, even though its type
 *    declaration exists. An `instanceof` check against `undefined` would
 *    throw, not just fail to match.
 * 2. Even in a real generated-client environment, duck-typing on the
 *    exact shape Prisma's own type declares (`{ name, code, clientVersion
 *    }`) is what actually matters for correctness here, and it keeps this
 *    module decoupled from needing a real `@prisma/client` import at all
 *    — useful given this project's raw-SQL-heavy repositories already
 *    don't depend on the generated client for anything else.
 */
export interface PrismaKnownRequestErrorShape {
  name: "PrismaClientKnownRequestError";
  code: string;
  clientVersion: string;
  meta?: Record<string, unknown>;
  message: string;
}

export function isPrismaKnownRequestError(
  error: unknown
): error is PrismaKnownRequestErrorShape {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "PrismaClientKnownRequestError" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { clientVersion?: unknown }).clientVersion === "string"
  );
}

interface MappedPrismaError {
  code: string;
  message: string;
  status: number;
}

/**
 * Maps Prisma's documented error codes to this platform's standardized
 * API error shape. Only the codes explicitly named in the Task 9 spec are
 * given specific handling; every other Prisma error code (there are
 * several dozen, covering everything from connection issues to query
 * engine internals) falls through to a generic, sanitized 500 — never a
 * raw Prisma message, which can include table/column names or, in some
 * cases, connection details.
 */
function mapPrismaErrorCode(code: string): MappedPrismaError {
  switch (code) {
    case "P2002": // Unique constraint violation
      return {
        code: "duplicate_resource",
        message: "A record with these details already exists.",
        status: 409,
      };
    case "P2025": // Record required for this operation was not found
      return {
        code: "not_found",
        message: "The requested record was not found.",
        status: 404,
      };
    case "P2003": // Foreign key constraint violation
      return {
        code: "conflict",
        message: "This action conflicts with related data and cannot be completed.",
        status: 409,
      };
    default:
      return {
        code: "database_error",
        message: "A database error occurred. Please try again.",
        status: 500,
      };
  }
}

/**
 * The universal fallback for any route's catch-all: call this instead of
 * `throw error` (which, left to Next.js's own default handling, is the
 * kind of behavior the Task 9 spec is explicitly asking to no longer rely
 * on) or `error.message` (which can contain internal detail — a raw
 * Postgres error string, a file path, or, in some Prisma error cases, a
 * connection string). Always logs the REAL error server-side first, via
 * `console.error`, so nothing is lost for debugging — only the
 * client-facing response is sanitized.
 *
 * `routeContext` is a short, static label (e.g. "PATCH /api/properties/[id]")
 * for the server log line — never anything derived from the request body
 * or a caught error's own message.
 */
export function handleUnexpectedError(error: unknown, routeContext: string): NextResponse {
  console.error(`[${routeContext}] Unhandled error:`, error);

  if (isPrismaKnownRequestError(error)) {
    const mapped = mapPrismaErrorCode(error.code);
    const options: ApiErrorOptions = { status: mapped.status };
    return errorResponse(mapped.code, mapped.message, options);
  }

  return errorResponse(
    "internal_error",
    "Something went wrong. Please try again.",
    { status: 500 }
  );
}
