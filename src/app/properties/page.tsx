"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import {
  SearchFilters,
  EMPTY_FILTERS,
  filtersToSearchParams,
} from "@/components/search/SearchFilters";
import { ViewToggle, type ViewMode } from "@/components/search/ViewToggle";
import { PropertyCard } from "@/components/search/PropertyCard";
import { OverpricedEvaluatorWidget } from "@/components/analytics/OverpricedEvaluatorWidget";
import { Spinner } from "@/components/ui/Badge";
import type { DiscoveryResult } from "@/lib/api/types";

/**
 * Leaflet reads `window`/`document` at import time, which doesn't exist
 * during Next.js's server render — `next/dynamic` with `ssr: false` is
 * the standard, documented way to keep a browser-only component out of
 * the server render pass entirely, even inside an already-client
 * component like this page.
 */
const PropertyMap = dynamic(
  () => import("@/components/map/PropertyMap").then((mod) => mod.PropertyMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading map…" />
      </div>
    ),
  }
);

// Addis Ababa's approximate center — used as the map's default view
// before any location-specific centroid is available.
const DEFAULT_MAP_CENTER = { latitude: 9.0084, longitude: 38.7575 };

export default function PropertiesPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [mapViewport, setMapViewport] = useState<{
    latitude: number;
    longitude: number;
    radiusMeters: number;
  } | null>(null);
  const [selectedResult, setSelectedResult] = useState<DiscoveryResult | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiClient.listLocations(),
  });

  const propertyTypesQuery = useQuery({
    queryKey: ["propertyTypes"],
    queryFn: () => apiClient.listPropertyTypes(),
  });

  const searchParams = useMemo(() => {
    const base = filtersToSearchParams(filters);
    // In split/map view, the map's own viewport (once the user has
    // panned/zoomed) takes over spatial filtering from the plain filter
    // panel — the map itself IS the location control at that point.
    return mapViewport && viewMode === "split" ? { ...base, ...mapViewport } : base;
  }, [filters, mapViewport, viewMode]);

  const searchQuery = useQuery({
    queryKey: ["propertySearch", searchParams],
    queryFn: () => apiClient.searchProperties(searchParams),
  });

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of locationsQuery.data ?? []) {
      map.set(location.id, location.name);
    }
    return map;
  }, [locationsQuery.data]);

  const results = searchQuery.data ?? [];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-stone-900">Find a property</h1>
        <p className="text-stone-600">
          Search active listings across Addis Ababa, with live market intelligence.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-6">
          <SearchFilters
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
            locations={locationsQuery.data ?? []}
            propertyTypes={propertyTypesQuery.data ?? []}
          />
          <OverpricedEvaluatorWidget
            locations={locationsQuery.data ?? []}
            propertyTypes={propertyTypesQuery.data ?? []}
          />
        </aside>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-600">
              {searchQuery.isLoading ? (
                <Spinner label="Searching…" />
              ) : (
                `${results.length} result${results.length === 1 ? "" : "s"}`
              )}
            </p>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>

          {searchQuery.isError && (
            <p role="alert" className="text-sm text-red-700">
              {searchQuery.error instanceof Error
                ? searchQuery.error.message
                : "Something went wrong while searching."}
            </p>
          )}

          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((result) => (
                <PropertyCard
                  key={result.listingId}
                  result={result}
                  locationName={locationNameById.get(result.locationNodeId)}
                  onSelect={setSelectedResult}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
              <div className="h-[600px] overflow-hidden rounded-lg border border-stone-200">
                <PropertyMap
                  results={results}
                  center={selectedResult?.coordinates ?? DEFAULT_MAP_CENTER}
                  onViewportChange={setMapViewport}
                  onSelectResult={setSelectedResult}
                />
              </div>
              <div className="flex max-h-[600px] flex-col gap-3 overflow-y-auto">
                {results.map((result) => (
                  <PropertyCard
                    key={result.listingId}
                    result={result}
                    locationName={locationNameById.get(result.locationNodeId)}
                    onSelect={setSelectedResult}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
