import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation/identity";
import {
  authService,
  DuplicateEmailError,
  RateLimitExceededError,
} from "@/modules/identity/services/authService";
import { getClientIp } from "@/lib/getClientIp";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "One or more fields are invalid.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const user = await authService.registerUser(parsed.data, { ip: getClientIp(request) });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          status: user.status,
          createdAt: user.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      // Explicit, by product decision: returning users get immediate
      // feedback rather than an ambiguous generic response, at the cost
      // of a registration-side account-enumeration signal. See
      // docs/authentication-hardening.md §5 for the full trade-off.
      return NextResponse.json(
        { error: "duplicate_email", message: error.message },
        { status: 409 }
      );
    }

    if (error instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: "rate_limited", message: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        }
      );
    }

    console.error("Unexpected error during registration:", error);
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

