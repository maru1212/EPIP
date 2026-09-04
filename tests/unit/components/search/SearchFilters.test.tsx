import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SearchFilters,
  EMPTY_FILTERS,
  filtersToSearchParams,
  type SearchFiltersState,
} from "@/components/search/SearchFilters";
import type { LocationNode, PropertyType } from "@/lib/api/types";

const LOCATIONS: LocationNode[] = [
  { id: "loc-bole", parentId: null, level: "subcity", name: "Bole", slug: "bole", centroid: null },
  { id: "loc-yeka", parentId: null, level: "subcity", name: "Yeka", slug: "yeka", centroid: null },
];

const PROPERTY_TYPES: PropertyType[] = [
  { id: "type-apartment", key: "apartment", label: "Apartment", labelAmharic: null },
  { id: "type-house", key: "house", label: "House", labelAmharic: null },
];

describe("filtersToSearchParams", () => {
  it("converts an all-empty filter state into an all-undefined params object", () => {
    expect(filtersToSearchParams(EMPTY_FILTERS)).toEqual({
      locationNodeId: undefined,
      propertyType: undefined,
      listingType: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minBedrooms: undefined,
      minBathrooms: undefined,
    });
  });

  it("converts string price/bedroom/bathroom fields to numbers", () => {
    const filters: SearchFiltersState = {
      ...EMPTY_FILTERS,
      minPrice: "1000000",
      maxPrice: "15000000",
      minBedrooms: "2",
      minBathrooms: "1",
    };

    const params = filtersToSearchParams(filters);

    expect(params.minPrice).toBe(1_000_000);
    expect(params.maxPrice).toBe(15_000_000);
    expect(params.minBedrooms).toBe(2);
    expect(params.minBathrooms).toBe(1);
  });

  it("passes through locationNodeId, propertyType, and listingType unchanged when set", () => {
    const filters: SearchFiltersState = {
      ...EMPTY_FILTERS,
      locationNodeId: "loc-bole",
      propertyType: "type-apartment",
      listingType: "sale",
    };

    expect(filtersToSearchParams(filters)).toMatchObject({
      locationNodeId: "loc-bole",
      propertyType: "type-apartment",
      listingType: "sale",
    });
  });
});

describe("SearchFilters component", () => {
  it("renders all filter controls with the provided location and property type options", () => {
    render(
      <SearchFilters
        filters={EMPTY_FILTERS}
        onChange={vi.fn()}
        onReset={vi.fn()}
        locations={LOCATIONS}
        propertyTypes={PROPERTY_TYPES}
      />
    );

    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    expect(screen.getByText("Bole")).toBeInTheDocument();
    expect(screen.getByText("Yeka")).toBeInTheDocument();
    expect(screen.getByText("Apartment")).toBeInTheDocument();
    expect(screen.getByLabelText(/listing type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/min price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max price/i)).toBeInTheDocument();
  });

  it("calls onChange with the updated filter state when a value changes, without mutating other fields", () => {
    const handleChange = vi.fn();
    render(
      <SearchFilters
        filters={{ ...EMPTY_FILTERS, minPrice: "1000000" }}
        onChange={handleChange}
        onReset={vi.fn()}
        locations={LOCATIONS}
        propertyTypes={PROPERTY_TYPES}
      />
    );

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "loc-bole" } });

    expect(handleChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      minPrice: "1000000",
      locationNodeId: "loc-bole",
    });
  });

  it("calls onReset when the reset button is clicked", () => {
    const handleReset = vi.fn();
    render(
      <SearchFilters
        filters={EMPTY_FILTERS}
        onChange={vi.fn()}
        onReset={handleReset}
        locations={LOCATIONS}
        propertyTypes={PROPERTY_TYPES}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));

    expect(handleReset).toHaveBeenCalledTimes(1);
  });
});
