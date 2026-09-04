import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OverpricedEvaluatorWidget } from "@/components/analytics/OverpricedEvaluatorWidget";
import { apiClient } from "@/lib/api/client";
import type { LocationNode, PropertyType } from "@/lib/api/types";

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, evaluateListing: vi.fn() } };
});

const LOCATIONS: LocationNode[] = [
  {
    id: "loc-bole",
    parentId: null,
    level: "subcity",
    name: "Bole",
    slug: "bole",
    centroid: { latitude: 8.9979, longitude: 38.7969 },
  },
  {
    id: "loc-no-boundary",
    parentId: null,
    level: "subcity",
    name: "Yeka",
    slug: "yeka",
    centroid: null,
  },
];

const PROPERTY_TYPES: PropertyType[] = [
  { id: "type-apartment", key: "apartment", label: "Apartment", labelAmharic: null },
];

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OverpricedEvaluatorWidget locations={LOCATIONS} propertyTypes={PROPERTY_TYPES} />
    </QueryClientProvider>
  );
}

function fillAndSubmitForm() {
  fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "loc-bole" } });
  fireEvent.change(screen.getByLabelText(/property type/i), {
    target: { value: "type-apartment" },
  });
  fireEvent.change(screen.getByLabelText(/area/i), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText(/asking price/i), { target: { value: "5000000" } });
  fireEvent.click(screen.getByRole("button", { name: /evaluate/i }));
}

beforeEach(() => {
  vi.mocked(apiClient.evaluateListing).mockReset();
});

describe("OverpricedEvaluatorWidget", () => {
  it("derives latitude/longitude from the selected location's centroid, not from any coordinate the user typed", async () => {
    vi.mocked(apiClient.evaluateListing).mockResolvedValue({
      sufficient: false,
      message: "x",
      comparableCount: 0,
    });

    renderWidget();
    fillAndSubmitForm();

    await waitFor(() => {
      expect(apiClient.evaluateListing).toHaveBeenCalledWith({
        latitude: 8.9979,
        longitude: 38.7969,
        buildingSize: 100,
        propertyTypeId: "type-apartment",
        askingPrice: 5_000_000,
      });
    });
  });

  it("warns and disables submission for a location with no coordinate data", () => {
    renderWidget();

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "loc-no-boundary" } });

    expect(screen.getByText(/doesn't have coordinate data yet/i)).toBeInTheDocument();
  });

  it("renders the OVERPRICED state with red/danger styling and the percentage differential", async () => {
    vi.mocked(apiClient.evaluateListing).mockResolvedValue({
      sufficient: true,
      assessment: "overpriced",
      percentageDifference: 23.4,
      askingPricePerSqm: 80_000,
      medianComparablePricePerSqm: 50_000,
      comparableCount: 5,
    });

    renderWidget();
    fillAndSubmitForm();

    const resultContainer = await screen.findByTestId("valuation-result");
    const badge = within(resultContainer).getByText("Overpriced", {
      selector: "span.rounded-full",
    });
    expect(badge).toBeInTheDocument();
    expect(screen.getByText(/\+23\.4% vs\. neighborhood median/i)).toBeInTheDocument();
    expect(resultContainer).toBeInTheDocument();
  });

  it("renders the FAIRLY_PRICED state", async () => {
    vi.mocked(apiClient.evaluateListing).mockResolvedValue({
      sufficient: true,
      assessment: "fairly_priced",
      percentageDifference: 2.1,
      askingPricePerSqm: 51_000,
      medianComparablePricePerSqm: 50_000,
      comparableCount: 8,
    });

    renderWidget();
    fillAndSubmitForm();

    expect(await screen.findByText("Fairly Priced")).toBeInTheDocument();
  });

  it("renders the UNDERPRICED state", async () => {
    vi.mocked(apiClient.evaluateListing).mockResolvedValue({
      sufficient: true,
      assessment: "underpriced",
      percentageDifference: -18.0,
      askingPricePerSqm: 41_000,
      medianComparablePricePerSqm: 50_000,
      comparableCount: 4,
    });

    renderWidget();
    fillAndSubmitForm();

    const resultContainer = await screen.findByTestId("valuation-result");
    const badge = within(resultContainer).getByText("Underpriced", {
      selector: "span.rounded-full",
    });
    expect(badge).toBeInTheDocument();
    expect(screen.getByText(/-18\.0% vs\. neighborhood median/i)).toBeInTheDocument();
  });

  it("renders an insufficient-data message, not an error, when the assessment can't be made", async () => {
    vi.mocked(apiClient.evaluateListing).mockResolvedValue({
      sufficient: false,
      message: "Not enough comparable market data was found.",
      comparableCount: 0,
    });

    renderWidget();
    fillAndSubmitForm();

    expect(await screen.findByTestId("valuation-insufficient")).toHaveTextContent(
      "Not enough comparable market data was found."
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error message when the API call fails", async () => {
    const { ApiClientError } = await import("@/lib/api/client");
    vi.mocked(apiClient.evaluateListing).mockRejectedValue(
      new ApiClientError("Rate limit exceeded.", "rate_limited", 429)
    );

    renderWidget();
    fillAndSubmitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit exceeded.");
  });

  it("disables the Evaluate button until all required fields are filled", () => {
    renderWidget();

    expect(screen.getByRole("button", { name: /evaluate/i })).toBeDisabled();
  });
});
