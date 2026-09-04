import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import B2BMarketDataPage from "@/app/b2b/market-data/page";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { LocationNode, NeighborhoodStats } from "@/lib/api/types";

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listLocations: vi.fn(),
      getNeighborhoodStats: vi.fn(),
    },
  };
});

const LOCATIONS: LocationNode[] = [
  { id: "loc-bole", parentId: null, level: "subcity", name: "Bole", slug: "bole", centroid: null },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <B2BMarketDataPage />
    </QueryClientProvider>
  );
}

async function selectBole() {
  await screen.findByRole("option", { name: "Bole" });
  fireEvent.change(screen.getByLabelText(/subcity \/ neighborhood/i), {
    target: { value: "loc-bole" },
  });
}

beforeEach(() => {
  vi.mocked(apiClient.listLocations).mockResolvedValue(LOCATIONS);
  vi.mocked(apiClient.getNeighborhoodStats).mockReset();
});

describe("B2BMarketDataPage", () => {
  it("renders metric cards and the category breakdown table for a location with real data", async () => {
    const stats: NeighborhoodStats = {
      locationNodeId: "loc-bole",
      includedLocationNodeCount: 3,
      activeListingCount: 12,
      medianPrice: 5_000_000,
      medianPricePerSqm: 50_000,
      priceRange: { min: 3_000_000, max: 9_000_000 },
      categoryBreakdown: [
        { category: "residential", activeListingCount: 8, medianPricePerSqm: 48_000 },
        { category: "commercial", activeListingCount: 4, medianPricePerSqm: 65_000 },
      ],
      trendDirection: "unavailable",
    };
    vi.mocked(apiClient.getNeighborhoodStats).mockResolvedValue(stats);

    renderPage();
    await selectBole();

    expect(await screen.findByText("50,000 ETB")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Residential")).toBeInTheDocument();
    expect(screen.getByText("Commercial")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders a clean zero-data state without crashing when a location has no listings", async () => {
    const stats: NeighborhoodStats = {
      locationNodeId: "loc-bole",
      includedLocationNodeCount: 1,
      activeListingCount: 0,
      medianPrice: null,
      medianPricePerSqm: null,
      priceRange: { min: null, max: null },
      categoryBreakdown: [],
      trendDirection: "unavailable",
    };
    vi.mocked(apiClient.getNeighborhoodStats).mockResolvedValue(stats);

    renderPage();
    await selectBole();

    await waitFor(() =>
      expect(screen.getByTestId("category-breakdown-empty")).toBeInTheDocument()
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders the unauthorized fallback on a 403 without showing a generic error", async () => {
    vi.mocked(apiClient.getNeighborhoodStats).mockRejectedValue(
      new ApiClientError("Forbidden.", "forbidden", 403)
    );

    renderPage();
    await selectBole();

    expect(await screen.findByTestId("unauthorized-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not query stats until a location is selected", () => {
    renderPage();

    expect(apiClient.getNeighborhoodStats).not.toHaveBeenCalled();
    expect(screen.getByText(/select a location/i)).toBeInTheDocument();
  });
});
