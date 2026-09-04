"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner, Badge } from "@/components/ui/Badge";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { EvaluateListingResult, LocationNode, PropertyType } from "@/lib/api/types";

export interface OverpricedEvaluatorWidgetProps {
  locations: LocationNode[];
  propertyTypes: PropertyType[];
}

/**
 * The Task 11 spec asks for a "select location/subcity, enter area, enter
 * asking price" form. The backend's direct-parameters mode of
 * POST /api/analytics/evaluate-listing, however, requires precise
 * latitude/longitude plus a propertyTypeId (Task 8's own deliberate
 * design — comparable matching needs an exact point and property type,
 * not a named area) — a location dropdown alone can't satisfy that
 * contract. Resolved here by using the selected location's centroid
 * (derived server-side from LocationNode.boundary, see
 * GET /api/locations) as the representative coordinate, and adding a
 * property-type selector beyond the spec's literal field list, since the
 * API requires it. A location with no recorded boundary has no centroid
 * and is disabled in the dropdown with an explanatory note — see
 * docs/frontend-portal.md, since no real boundary data is seeded
 * anywhere in this project yet.
 */
export function OverpricedEvaluatorWidget({
  locations,
  propertyTypes,
}: OverpricedEvaluatorWidgetProps) {
  const [locationId, setLocationId] = useState("");
  const [propertyTypeId, setPropertyTypeId] = useState("");
  const [areaSqm, setAreaSqm] = useState("");
  const [askingPrice, setAskingPrice] = useState("");

  const mutation = useMutation<EvaluateListingResult, ApiClientError>({
    mutationFn: async () => {
      const location = locations.find((l) => l.id === locationId);
      if (!location?.centroid) {
        throw new ApiClientError(
          "This location has no coordinate data yet, so it can't be evaluated.",
          "no_coordinates",
          0
        );
      }
      return apiClient.evaluateListing({
        latitude: location.centroid.latitude,
        longitude: location.centroid.longitude,
        buildingSize: Number(areaSqm),
        propertyTypeId,
        askingPrice: Number(askingPrice),
      });
    },
  });

  const selectedLocation = locations.find((l) => l.id === locationId);
  const canSubmit =
    locationId !== "" &&
    propertyTypeId !== "" &&
    areaSqm !== "" &&
    askingPrice !== "" &&
    Number(areaSqm) > 0 &&
    Number(askingPrice) > 0;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5"
      data-testid="overpriced-widget"
    >
      <h2 className="text-lg font-semibold text-stone-900">Is this property overpriced?</h2>

      <Select
        label="Location"
        placeholder="Choose a subcity"
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        options={locations.map((location) => ({
          value: location.id,
          label: location.centroid ? location.name : `${location.name} (no coordinate data)`,
        }))}
      />
      {selectedLocation && !selectedLocation.centroid && (
        <p className="text-sm text-amber-700">
          This location doesn&apos;t have coordinate data yet, so it can&apos;t be evaluated.
        </p>
      )}

      <Select
        label="Property Type"
        placeholder="Choose a type"
        value={propertyTypeId}
        onChange={(e) => setPropertyTypeId(e.target.value)}
        options={propertyTypes.map((type) => ({ value: type.id, label: type.label }))}
      />

      <Input
        label="Area (m²)"
        type="number"
        min={1}
        value={areaSqm}
        onChange={(e) => setAreaSqm(e.target.value)}
      />

      <Input
        label="Asking Price (ETB)"
        type="number"
        min={1}
        value={askingPrice}
        onChange={(e) => setAskingPrice(e.target.value)}
      />

      <Button
        type="button"
        disabled={!canSubmit || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? <Spinner label="Evaluating…" /> : "Evaluate"}
      </Button>

      {mutation.isError && (
        <p role="alert" className="text-sm text-red-700">
          {mutation.error.message}
        </p>
      )}

      {mutation.isSuccess && <ResultDisplay result={mutation.data} />}
    </div>
  );
}

const ASSESSMENT_LABELS: Record<
  "overpriced" | "fairly_priced" | "underpriced",
  { label: string; tone: "danger" | "success" | "info"; gaugePercent: number }
> = {
  overpriced: { label: "Overpriced", tone: "danger", gaugePercent: 85 },
  fairly_priced: { label: "Fairly Priced", tone: "success", gaugePercent: 50 },
  underpriced: { label: "Underpriced", tone: "info", gaugePercent: 15 },
};

/**
 * A simple horizontal gauge — a colored dot positioned along an
 * underpriced-to-overpriced track — rather than a literal circular
 * speedometer. Communicates the same "where does this fall on the
 * spectrum" information with far less markup/SVG complexity, and reads
 * clearly at a glance, which matters more here than a literal dial.
 */
function Gauge({ assessment }: { assessment: "overpriced" | "fairly_priced" | "underpriced" }) {
  const { gaugePercent } = ASSESSMENT_LABELS[assessment];
  return (
    <div className="flex flex-col gap-1" data-testid="valuation-gauge">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-gradient-to-r from-blue-400 via-emerald-400 to-red-400">
        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-stone-900 shadow"
          style={{ left: `${gaugePercent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-stone-500">
        <span>Underpriced</span>
        <span>Fair</span>
        <span>Overpriced</span>
      </div>
    </div>
  );
}

function ResultDisplay({ result }: { result: EvaluateListingResult }) {
  if (!result.sufficient) {
    return (
      <p className="text-sm text-stone-600" data-testid="valuation-insufficient">
        {result.message}
      </p>
    );
  }

  const { label, tone } = ASSESSMENT_LABELS[result.assessment];

  return (
    <div
      className="flex flex-col gap-3 border-t border-stone-200 pt-4"
      data-testid="valuation-result"
    >
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        <span className="text-sm text-stone-500">
          {result.percentageDifference > 0 ? "+" : ""}
          {result.percentageDifference.toFixed(1)}% vs. neighborhood median
        </span>
      </div>

      <Gauge assessment={result.assessment} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Asking price / m²</dt>
        <dd className="text-right font-medium text-stone-900">
          {Math.round(result.askingPricePerSqm).toLocaleString()}
        </dd>
        <dt className="text-stone-500">Neighborhood median / m²</dt>
        <dd className="text-right font-medium text-stone-900">
          {Math.round(result.medianComparablePricePerSqm).toLocaleString()}
        </dd>
        <dt className="text-stone-500">Based on</dt>
        <dd className="text-right font-medium text-stone-900">
          {result.comparableCount} comparable{result.comparableCount === 1 ? "" : "s"}
        </dd>
      </dl>
    </div>
  );
}
