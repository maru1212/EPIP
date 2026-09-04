import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import B2BValuationReportPage from "@/app/b2b/valuations/[id]/page";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { AiSummaryResult, ValuationReportDetail } from "@/lib/api/types";

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getValuationReport: vi.fn(),
      getAiSummary: vi.fn(),
    },
  };
});

const BASE_REPORT: ValuationReportDetail = {
  id: "report-1",
  propertyId: "prop-1",
  requestedByUserId: "user-1",
  estimatedValue: 5_000_000,
  lowEstimate: 4_500_000,
  highEstimate: 5_500_000,
  confidenceScore: 0.82,
  methodology: "comparable_sales",
  status: "completed",
  rawAiResponse: null,
  valuationData: {
    comparables: [
      {
        listingId: "listing-1",
        propertyId: "comp-1",
        displayAddress: "Bole Road, near Edna Mall",
        areaSqm: 100,
        price: 4_950_000,
        pricePerSqm: 49_500,
        distanceMeters: 320,
        condition: "good",
      },
    ],
  },
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

async function renderPage(id = "report-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <B2BValuationReportPage params={Promise.resolve({ id })} />
      </QueryClientProvider>
    );
  });
  return result;
}

beforeEach(() => {
  vi.mocked(apiClient.getValuationReport).mockReset();
  vi.mocked(apiClient.getAiSummary).mockReset();
});

describe("B2BValuationReportPage", () => {
  it("renders the value range, confidence gauge, and comparables table from statistical data", async () => {
    vi.mocked(apiClient.getValuationReport).mockResolvedValue(BASE_REPORT);
    vi.mocked(apiClient.getAiSummary).mockResolvedValue({
      aiEnriched: false,
      narrative: null,
      report: BASE_REPORT as unknown as AiSummaryResult["report"],
    });

    await renderPage();

    expect(await screen.findByText("5,000,000 ETB")).toBeInTheDocument();
    expect(screen.getByText("4,500,000 ETB")).toBeInTheDocument();
    expect(screen.getByText("5,500,000 ETB")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-gauge")).toHaveTextContent("82%");
    expect(screen.getByText("Bole Road, near Edna Mall")).toBeInTheDocument();
    expect(screen.getByText("320 m")).toBeInTheDocument();
  });

  it("renders the AI narrative sections when enrichment is present", async () => {
    vi.mocked(apiClient.getValuationReport).mockResolvedValue(BASE_REPORT);
    vi.mocked(apiClient.getAiSummary).mockResolvedValue({
      aiEnriched: true,
      narrative: {
        executiveSummary: "Solid mid-market apartment.",
        locationAnalysis: "Bole is a commercial hub.",
        pricingFactors: "Driven by comparable sales.",
        confidenceExplanation: "Based on 5 comparables.",
      },
      report: BASE_REPORT as unknown as AiSummaryResult["report"],
    });

    await renderPage();

    expect(await screen.findByText("Solid mid-market apartment.")).toBeInTheDocument();
    expect(screen.getByText("Bole is a commercial hub.")).toBeInTheDocument();
    expect(screen.getByTestId("narrative-section")).toBeInTheDocument();
  });

  it("shows a clean 'no narrative yet' message rather than an error when AI enrichment is absent", async () => {
    vi.mocked(apiClient.getValuationReport).mockResolvedValue(BASE_REPORT);
    vi.mocked(apiClient.getAiSummary).mockResolvedValue({
      aiEnriched: false,
      narrative: null,
      report: BASE_REPORT as unknown as AiSummaryResult["report"],
    });

    await renderPage();

    expect(await screen.findByTestId("narrative-unavailable")).toBeInTheDocument();
  });

  it("shows a clean message when a report has no persisted comparable details", async () => {
    vi.mocked(apiClient.getValuationReport).mockResolvedValue({
      ...BASE_REPORT,
      valuationData: { comparableCount: 3 },
    });
    vi.mocked(apiClient.getAiSummary).mockResolvedValue({
      aiEnriched: false,
      narrative: null,
      report: BASE_REPORT as unknown as AiSummaryResult["report"],
    });

    await renderPage();

    expect(await screen.findByTestId("comparables-empty")).toBeInTheDocument();
  });

  it("renders the unauthorized fallback for a 403, not a generic error", async () => {
    vi.mocked(apiClient.getValuationReport).mockRejectedValue(
      new ApiClientError("Forbidden.", "forbidden", 403)
    );

    await renderPage();

    expect(await screen.findByTestId("unauthorized-fallback")).toBeInTheDocument();
  });
});
