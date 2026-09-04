import { NextResponse } from "next/server";

/**
 * Standardized response envelope for Task 8's new endpoints (search,
 * analytics, B2B). Deliberately NOT retrofitted onto Tasks 5-7's existing
 * routes (property/listing/valuation) — that would be a large, disruptive
 * change to already-signed-off, tested response shapes, and wasn't asked
 * for. This is a real, acknowledged inconsistency across the API surface
 * right now: older endpoints return `{ property: ... }`/`{ listing: ... }`
 * directly, these return `{ success, data, meta }`/`{ success: false,
 * error }`. See docs/search-and-b2b-domain.md.
 */

export interface SuccessResponseMeta {
  pagination?: { limit: number; offset: number; count: number };
  rateLimit?: { remaining: number; resetAt: string };
  [key: string]: unknown;
}

export function successResponse<T>(
  data: T,
  options: { status?: number; meta?: SuccessResponseMeta } = {}
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
      ...(options.meta ? { meta: options.meta } : {}),
    },
    { status: options.status ?? 200 }
  );
}

export interface ApiErrorOptions {
  status: number;
  details?: unknown;
  headers?: Record<string, string>;
}

/**
 * `message` is always safe, user-facing text — never a raw caught error's
 * `.message` (which could contain internal details, e.g. a database
 * driver's error string). Route handlers are responsible for mapping
 * known domain errors to a specific `code`/`message`/`status` here, and
 * for logging the real error server-side (`console.error`) separately
 * before calling this for the generic/unexpected case — same pattern
 * already established in every prior task's route handlers.
 */
export function errorResponse(
  code: string,
  message: string,
  options: ApiErrorOptions
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(options.details !== undefined ? { details: options.details } : {}),
      },
    },
    { status: options.status, headers: options.headers }
  );
}
