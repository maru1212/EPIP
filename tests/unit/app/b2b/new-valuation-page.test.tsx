import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewCollateralValuationPage from "@/app/b2b/valuations/new/page";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { LocationNode, PropertyType } from "@/lib/api/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listLocations: vi.fn(),
      listPropertyTypes: vi.fn(),
      createProperty: vi.fn(),
      estimateValuation: vi.fn(),
      generateAiReport: vi.fn(),
    },
  };
});

const LOCATIONS: LocationNode[] = [
  { id: "loc-bole", parentId: null, level: "subcity", name: "Bole", slug: "bole", centroid: null },
];
const PROPERTY_TYPES: PropertyType[] = [
  { id: "type-apartment", key: "apartment", label: "Apartment", labelAmharic: null },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NewCollateralValuationPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  pushMock.mockReset();
  vi.mocked(apiClient.listLocations).mockResolvedValue(LOCATIONS);
  vi.mocked(apiClient.listPropertyTypes).mockResolvedValue(PROPERTY_TYPES);
  vi.mocked(apiClient.createProperty).mockReset();
  vi.mocked(apiClient.estimateValuation).mockReset();
  vi.mocked(apiClient.generateAiReport).mockReset();
});

describe("NewCollateralValuationPage", () => {
  it("defaults to the existing-property-ID mode and requires an ID before submitting", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a property ID.");
    expect(apiClient.estimateValuation).not.toHaveBeenCalled();
    expect(apiClient.generateAiReport).not.toHaveBeenCalled();
  });

  it("submits the existing property ID with AI enrichment enabled by default", async () => {
    vi.mocked(apiClient.generateAiReport).mockResolvedValue({
      persisted: true,
      aiEnriched: true,
      report: {
        id: "report-1",
        propertyId: "prop-1",
        estimatedValue: 5_000_000,
        lowEstimate: 4_500_000,
        highEstimate: 5_500_000,
        confidenceScore: 0.8,
        methodology: "comparable_sales",
        createdAt: new Date().toISOString(),
      },
      comparableCount: 5,
    });

    renderPage();
    fireEvent.change(screen.getByLabelText(/property id/i), { target: { value: "prop-1" } });
    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    await waitFor(() => expect(apiClient.generateAiReport).toHaveBeenCalledWith("prop-1"));
    expect(apiClient.estimateValuation).not.toHaveBeenCalled();
    expect(apiClient.createProperty).not.toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/b2b/valuations/report-1"));
  });

  it("calls the pure statistical endpoint (not AI) when the AI toggle is disabled", async () => {
    vi.mocked(apiClient.estimateValuation).mockResolvedValue({
      persisted: true,
      report: {
        id: "report-2",
        propertyId: "prop-1",
        estimatedValue: 5_000_000,
        lowEstimate: 4_500_000,
        highEstimate: 5_500_000,
        confidenceScore: 0.8,
        methodology: "comparable_sales",
        createdAt: new Date().toISOString(),
      },
      comparableCount: 5,
    });

    renderPage();
    fireEvent.change(screen.getByLabelText(/property id/i), { target: { value: "prop-1" } });
    fireEvent.click(screen.getByLabelText(/enable ai narrative enrichment/i));
    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    await waitFor(() => expect(apiClient.estimateValuation).toHaveBeenCalledWith("prop-1"));
    expect(apiClient.generateAiReport).not.toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/b2b/valuations/report-2"));
  });

  it("in manual mode, creates a draft property first, then values the newly created property", async () => {
    vi.mocked(apiClient.createProperty).mockResolvedValue({ id: "new-prop-1" });
    vi.mocked(apiClient.generateAiReport).mockResolvedValue({
      persisted: true,
      aiEnriched: true,
      report: {
        id: "report-3",
        propertyId: "new-prop-1",
        estimatedValue: 3_000_000,
        lowEstimate: 2_700_000,
        highEstimate: 3_300_000,
        confidenceScore: 0.6,
        methodology: "comparable_sales",
        createdAt: new Date().toISOString(),
      },
      comparableCount: 2,
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /manual details/i }));

    await screen.findByLabelText(/^location$/i);
    await screen.findByRole("option", { name: "Bole" });
    fireEvent.change(screen.getByLabelText(/^location$/i), { target: { value: "loc-bole" } });
    await screen.findByRole("option", { name: "Apartment" });
    fireEvent.change(screen.getByLabelText(/property type/i), {
      target: { value: "type-apartment" },
    });
    fireEvent.change(screen.getByLabelText(/building size/i), { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    await waitFor(() =>
      expect(apiClient.createProperty).toHaveBeenCalledWith(
        expect.objectContaining({
          locationNodeId: "loc-bole",
          propertyTypeId: "type-apartment",
          buildingAreaSqm: 100,
        })
      )
    );
    await waitFor(() => expect(apiClient.generateAiReport).toHaveBeenCalledWith("new-prop-1"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/b2b/valuations/report-3"));
  });

  it("requires location, property type, and an area before submitting in manual mode", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /manual details/i }));

    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/location and property type/i);
    expect(apiClient.createProperty).not.toHaveBeenCalled();
  });

  it("shows an insufficient-data message rather than redirecting when no report is persisted", async () => {
    vi.mocked(apiClient.generateAiReport).mockResolvedValue({
      persisted: false,
      aiEnriched: false,
      report: null,
      comparableCount: 0,
      reason: "insufficient_comparable_data",
    });

    renderPage();
    fireEvent.change(screen.getByLabelText(/property id/i), { target: { value: "prop-1" } });
    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    expect(await screen.findByTestId("insufficient-data-message")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the unauthorized fallback instead of a generic error on a 403", async () => {
    vi.mocked(apiClient.generateAiReport).mockRejectedValue(
      new ApiClientError("Forbidden.", "forbidden", 403)
    );

    renderPage();
    fireEvent.change(screen.getByLabelText(/property id/i), { target: { value: "prop-1" } });
    fireEvent.click(screen.getByRole("button", { name: /generate valuation/i }));

    expect(await screen.findByTestId("unauthorized-fallback")).toBeInTheDocument();
  });
});
