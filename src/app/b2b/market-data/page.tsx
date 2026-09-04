"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Badge";
import { MetricCard } from "@/components/b2b/MetricCard";
import { CategoryBreakdownTable } from "@/components/b2b/CategoryBreakdownTable";
import { UnauthorizedFallback, isUnauthorizedError } from "@/components/b2b/UnauthorizedFallback";

function formatEtb(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value).toLocaleString()} ETB`;
}

export default function B2BMarketDataPage() {
  const [locationNodeId, setLocationNodeId] = useState("");

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiClient.listLocations(),
  });

  const statsQuery = useQuery({
    queryKey: ["neighborhoodStats", locationNodeId],
    queryFn: () => apiClient.getNeighborhoodStats(locationNodeId),
    enabled: locationNodeId !== "",
  });

  if (isUnauthorizedError(statsQuery.error)) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <UnauthorizedFallback error={statsQuery.error} />
      </main>
    );
  }

  const stats = statsQuery.data;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-stone-900">Neighborhood market analytics</h1>
        <p className="text-stone-600">
          Institutional-grade market statistics by subcity or neighborhood.
        </p>
      </header>

      <div className="max-w-xs">
        <Select
          label="Subcity / neighborhood"
          placeholder="Choose a location"
          value={locationNodeId}
          onChange={(e) => setLocationNodeId(e.target.value)}
          options={(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
        />
      </div>

      {locationNodeId === "" && (
        <p className="text-sm text-stone-500">Select a location to view its market statistics.</p>
      )}

      {statsQuery.isLoading && locationNodeId !== "" && <Spinner label="Loading market data…" />}

      {statsQuery.isError && !isUnauthorizedError(statsQuery.error) && (
        <p role="alert" className="text-sm text-red-700">
          {statsQuery.error instanceof ApiClientError
            ? statsQuery.error.message
            : "Something went wrong while loading market data."}
        </p>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Median price / m²" value={formatEtb(stats.medianPricePerSqm)} />
            <MetricCard
              label="Active listings"
              value={stats.activeListingCount.toLocaleString()}
            />
            <MetricCard
              label="Price range"
              value={
                stats.priceRange.min !== null && stats.priceRange.max !== null
                  ? `${formatEtb(stats.priceRange.min)} - ${formatEtb(stats.priceRange.max)}`
                  : "—"
              }
            />
            <MetricCard
              label="Historical trend"
              value="Unavailable"
              hint="Price-history tracking isn't collected yet"
            />
          </div>

          <section className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-base font-semibold text-stone-900">
              Price / m² by property category
            </h2>
            <CategoryBreakdownTable categories={stats.categoryBreakdown} />
          </section>
        </>
      )}
    </main>
  );
}
