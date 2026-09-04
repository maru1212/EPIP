"use client";

import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { LocationNode, PropertyType, SearchPropertiesParams } from "@/lib/api/types";

export interface SearchFiltersState {
  locationNodeId: string;
  propertyType: string;
  listingType: "" | "sale" | "rent";
  minPrice: string;
  maxPrice: string;
  minBedrooms: string;
  minBathrooms: string;
}

export const EMPTY_FILTERS: SearchFiltersState = {
  locationNodeId: "",
  propertyType: "",
  listingType: "",
  minPrice: "",
  maxPrice: "",
  minBedrooms: "",
  minBathrooms: "",
};

/**
 * Converts the form's string-based state into the numeric/typed query
 * params the search API actually expects. Kept as a pure, exported
 * function (not inlined in the component) so it can be unit-tested
 * directly, independent of rendering.
 */
export function filtersToSearchParams(filters: SearchFiltersState): SearchPropertiesParams {
  return {
    locationNodeId: filters.locationNodeId || undefined,
    propertyType: filters.propertyType || undefined,
    listingType: filters.listingType || undefined,
    minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
    minBedrooms: filters.minBedrooms ? Number(filters.minBedrooms) : undefined,
    minBathrooms: filters.minBathrooms ? Number(filters.minBathrooms) : undefined,
  };
}

export interface SearchFiltersProps {
  filters: SearchFiltersState;
  onChange: (filters: SearchFiltersState) => void;
  onReset: () => void;
  locations: LocationNode[];
  propertyTypes: PropertyType[];
}

export function SearchFilters({
  filters,
  onChange,
  onReset,
  locations,
  propertyTypes,
}: SearchFiltersProps) {
  function update<K extends keyof SearchFiltersState>(key: K, value: SearchFiltersState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4"
      data-testid="search-filters"
    >
      <Select
        label="Location"
        placeholder="Any location"
        value={filters.locationNodeId}
        onChange={(e) => update("locationNodeId", e.target.value)}
        options={locations.map((location) => ({ value: location.id, label: location.name }))}
      />

      <Select
        label="Property Type"
        placeholder="Any type"
        value={filters.propertyType}
        onChange={(e) => update("propertyType", e.target.value)}
        options={propertyTypes.map((type) => ({ value: type.id, label: type.label }))}
      />

      <Select
        label="Listing Type"
        placeholder="Sale or Rent"
        value={filters.listingType}
        onChange={(e) => update("listingType", e.target.value as SearchFiltersState["listingType"])}
        options={[
          { value: "sale", label: "For Sale" },
          { value: "rent", label: "For Rent" },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Min Price (ETB)"
          type="number"
          min={0}
          value={filters.minPrice}
          onChange={(e) => update("minPrice", e.target.value)}
        />
        <Input
          label="Max Price (ETB)"
          type="number"
          min={0}
          value={filters.maxPrice}
          onChange={(e) => update("maxPrice", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Min Bedrooms"
          type="number"
          min={0}
          value={filters.minBedrooms}
          onChange={(e) => update("minBedrooms", e.target.value)}
        />
        <Input
          label="Min Bathrooms"
          type="number"
          min={0}
          value={filters.minBathrooms}
          onChange={(e) => update("minBathrooms", e.target.value)}
        />
      </div>

      <Button variant="secondary" onClick={onReset} type="button">
        Reset filters
      </Button>
    </div>
  );
}
