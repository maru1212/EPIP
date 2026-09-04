import type {
  ApiResponse,
  DiscoveryResult,
  PropertyDetail,
  ListingDetailResponse,
  EvaluateListingResult,
  EvaluateListingInput,
  EstimateValuationResult,
  AiSummaryResult,
  LocationNode,
  PropertyType,
  SearchPropertiesParams,
  NeighborhoodStats,
  ValuationReportDetail,
  CreatePropertyInput,
  CreatedProperty,
  GenerateAiReportResult,
} from "./types";

/**
 * Thrown for both transport-level failures (network error, non-JSON
 * response) and application-level failures (the standardized `{success:
 * false, error}` envelope every backend route in this project returns).
 * Callers get one consistent error shape to handle regardless of which
 * layer failed — this is what "robust client-side error handling" means
 * in practice: a component never needs to distinguish "the fetch threw"
 * from "the server said no."
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (error) {
    // A genuine network failure (offline, DNS, CORS, etc.) — there is no
    // HTTP response at all to parse, so this is handled distinctly from
    // an error response the server actually sent.
    throw new ApiClientError(
      "Could not reach the server. Check your connection and try again.",
      "network_error",
      0,
      error
    );
  }

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch (error) {
    throw new ApiClientError(
      "The server returned an unexpected response.",
      "invalid_response",
      response.status,
      error
    );
  }

  if (!body.success) {
    throw new ApiClientError(body.error.message, body.error.code, response.status, body.error.details);
  }

  return body.data;
}

function buildQueryString<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const apiClient = {
  async searchProperties(params: SearchPropertiesParams = {}): Promise<DiscoveryResult[]> {
    return apiFetch<DiscoveryResult[]>(
      `/api/search/properties${buildQueryString(params)}`
    );
  },

  async getProperty(id: string): Promise<PropertyDetail> {
    return apiFetch<PropertyDetail>(`/api/properties/${id}`);
  },

  async getListing(id: string): Promise<ListingDetailResponse> {
    return apiFetch<ListingDetailResponse>(`/api/listings/${id}`);
  },

  async evaluateListing(input: EvaluateListingInput): Promise<EvaluateListingResult> {
    return apiFetch<EvaluateListingResult>("/api/analytics/evaluate-listing", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async estimateValuation(propertyId: string): Promise<EstimateValuationResult> {
    return apiFetch<EstimateValuationResult>("/api/valuations/estimate", {
      method: "POST",
      body: JSON.stringify({ propertyId }),
    });
  },

  async getAiSummary(reportId: string): Promise<AiSummaryResult> {
    return apiFetch<AiSummaryResult>(`/api/valuations/${reportId}/ai-summary`);
  },

  async listLocations(level?: string): Promise<LocationNode[]> {
    return apiFetch<LocationNode[]>(`/api/locations${buildQueryString({ level })}`);
  },

  async listPropertyTypes(): Promise<PropertyType[]> {
    return apiFetch<PropertyType[]>("/api/property-types");
  },

  async getNeighborhoodStats(locationNodeId: string): Promise<NeighborhoodStats> {
    return apiFetch<NeighborhoodStats>(
      `/api/v1/b2b/market-data/neighborhood-stats${buildQueryString({ locationNodeId })}`
    );
  },

  async getValuationReport(id: string): Promise<ValuationReportDetail> {
    return apiFetch<ValuationReportDetail>(`/api/valuations/${id}`);
  },

  async createProperty(input: CreatePropertyInput): Promise<CreatedProperty> {
    return apiFetch<CreatedProperty>("/api/properties", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async generateAiReport(propertyId: string): Promise<GenerateAiReportResult> {
    return apiFetch<GenerateAiReportResult>("/api/valuations/ai-report", {
      method: "POST",
      body: JSON.stringify({ propertyId }),
    });
  },
};
