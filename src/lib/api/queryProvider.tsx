"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * One QueryClient per browser session (not per-request, unlike a
 * server-only cache) — created inside `useState` so it survives
 * re-renders but isn't shared across users/requests on the server.
 * Defaults chosen for a public, read-mostly discovery portal: a short
 * staleness window keeps search results reasonably fresh without
 * re-fetching on every filter tweak's re-render, and disabling
 * refetch-on-window-focus avoids surprising re-fetches while a user is
 * mid-way through filling out the evaluator widget in another tab.
 */
export function ApiQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
