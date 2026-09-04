import { ApiClientError } from "@/lib/api/client";

/**
 * RBAC for `/b2b/*` is enforced by the backend (`market_data:read`,
 * `valuation:view`, `valuation:create` — see docs/b2b-portal.md §5), not
 * duplicated here. This component only interprets the 401/403 an
 * already-gated API call comes back with; it never makes its own
 * permission decision, which would be both redundant and a real security
 * risk if it ever drifted from the backend's actual policy.
 */
export function isUnauthorizedError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}

export function UnauthorizedFallback({ error }: { error: ApiClientError }) {
  const isSignedOut = error.status === 401;

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-stone-200 bg-white p-10 text-center"
      data-testid="unauthorized-fallback"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
          <path
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-stone-900">Unauthorized access</h2>
      <p className="max-w-sm text-sm text-stone-600">
        {isSignedOut
          ? "Sign in with an institutional or agent account to view this page."
          : "Your account doesn't have permission to view this B2B page. Contact an administrator if you believe this is a mistake."}
      </p>
    </div>
  );
}
