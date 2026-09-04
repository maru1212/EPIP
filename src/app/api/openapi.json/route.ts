import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi/spec";

/**
 * Deliberately NOT wrapped in the standard `{ success, data }` envelope —
 * this is a well-established exception. OpenAPI tooling (Swagger UI,
 * Redoc, client generators like openapi-generator) expects the raw spec
 * document at this kind of endpoint; wrapping it would break every one
 * of them. Public, no permission gate, no rate limiting — API
 * documentation describing protected endpoints doesn't itself need
 * protecting, the same way a restaurant's menu isn't locked even though
 * the kitchen is.
 */
export async function GET() {
  return NextResponse.json(openApiSpec);
}
