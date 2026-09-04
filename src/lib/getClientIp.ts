/**
 * Best-effort client IP extraction from standard proxy headers. There is
 * no fully spoof-proof way to get a client's real IP from inside the
 * application layer — a hostile client can send arbitrary
 * X-Forwarded-For values. This is safe *for rate limiting specifically*
 * as long as the deployment's edge/reverse proxy (Vercel, nginx, etc.) is
 * configured to overwrite/set these headers itself rather than passing
 * through whatever the client sent — a standard requirement for any
 * IP-based control, not something specific to this function. That
 * configuration is a deployment-time concern outside this codebase; this
 * function assumes it's done correctly.
 *
 * Falls back to a fixed string (not null/throwing) so a missing header in
 * local development doesn't break rate limiting — it just means every
 * request without a forwarded-for header shares one bucket, which is
 * exactly what you want when testing from one machine anyway.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}
