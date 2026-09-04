"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Badge";
import { UnauthorizedFallback, isUnauthorizedError } from "@/components/b2b/UnauthorizedFallback";

type Mode = "existing" | "manual";

const CONDITIONS = ["new", "excellent", "good", "needs_renovation", "under_construction"];

/**
 * Neither /api/valuations/estimate nor /api/valuations/ai-report accept
 * raw manual property details directly — both require an existing
 * Property row's id (Tasks 7/10's deliberate design: a valuation is
 * always "of" a saved Property). The "manual details" mode this form
 * offers is implemented by first creating a draft Property via the
 * existing POST /api/properties (Task 5), then valuing the property that
 * was just created — reusing real infrastructure rather than adding a
 * new "value from scratch" endpoint. This means the manual-entry path
 * needs `property:create` in addition to `valuation:create`; a
 * valuer/bank account without both will see the manual path fail with
 * an unauthorized error at the property-creation step specifically. See
 * docs/b2b-portal.md §4.
 */
export default function NewCollateralValuationPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("existing");
  const [propertyId, setPropertyId] = useState("");
  const [locationNodeId, setLocationNodeId] = useState("");
  const [propertyTypeId, setPropertyTypeId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [landAreaSqm, setLandAreaSqm] = useState("");
  const [buildingAreaSqm, setBuildingAreaSqm] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [condition, setCondition] = useState("");
  const [aiEnrichment, setAiEnrichment] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiClient.listLocations(),
  });
  const propertyTypesQuery = useQuery({
    queryKey: ["propertyTypes"],
    queryFn: () => apiClient.listPropertyTypes(),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      let targetPropertyId = propertyId;

      if (mode === "manual") {
        const created = await apiClient.createProperty({
          locationNodeId,
          propertyTypeId,
          coordinates:
            latitude && longitude
              ? { latitude: Number(latitude), longitude: Number(longitude) }
              : undefined,
          landAreaSqm: landAreaSqm ? Number(landAreaSqm) : undefined,
          buildingAreaSqm: buildingAreaSqm ? Number(buildingAreaSqm) : undefined,
          bedrooms: bedrooms ? Number(bedrooms) : undefined,
          condition: condition || undefined,
        });
        targetPropertyId = created.id;
      }

      return aiEnrichment
        ? apiClient.generateAiReport(targetPropertyId)
        : apiClient.estimateValuation(targetPropertyId);
    },
    onSuccess: (result) => {
      if (result.persisted && result.report) {
        router.push(`/b2b/valuations/${result.report.id}`);
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (mode === "existing" && propertyId.trim() === "") {
      setValidationError("Enter a property ID.");
      return;
    }
    if (mode === "manual" && (locationNodeId === "" || propertyTypeId === "")) {
      setValidationError("Location and property type are required.");
      return;
    }
    if (mode === "manual" && landAreaSqm === "" && buildingAreaSqm === "") {
      setValidationError("Enter a land area or building size.");
      return;
    }

    mutation.mutate();
  }

  if (isUnauthorizedError(mutation.error)) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <UnauthorizedFallback error={mutation.error} />
      </main>
    );
  }

  const outcome = mutation.data;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-stone-900">New collateral valuation</h1>
        <p className="text-stone-600">
          Generate an automated appraisal for lending or underwriting purposes.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5"
      >
        <div role="radiogroup" aria-label="Property source" className="flex gap-2">
          <button
            type="button"
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "existing" ? "bg-[#9a4a2c] text-white" : "border border-stone-300 text-stone-700"}`}
          >
            Existing property ID
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            onClick={() => setMode("manual")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "manual" ? "bg-[#9a4a2c] text-white" : "border border-stone-300 text-stone-700"}`}
          >
            Manual details
          </button>
        </div>

        {mode === "existing" ? (
          <Input
            label="Property ID"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            placeholder="UUID of an existing property"
          />
        ) : (
          <>
            <p className="text-xs text-stone-500">
              Manual entry creates a new draft property record, then values it — this requires
              property-creation permission in addition to valuation-generation permission.
            </p>
            <Select
              label="Location"
              placeholder="Choose a location"
              value={locationNodeId}
              onChange={(e) => setLocationNodeId(e.target.value)}
              options={(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
            />
            <Select
              label="Property type"
              placeholder="Choose a type"
              value={propertyTypeId}
              onChange={(e) => setPropertyTypeId(e.target.value)}
              options={(propertyTypesQuery.data ?? []).map((t) => ({
                value: t.id,
                label: t.label,
              }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Latitude"
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
              />
              <Input
                label="Longitude"
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Land area (m²)"
                type="number"
                min={0}
                value={landAreaSqm}
                onChange={(e) => setLandAreaSqm(e.target.value)}
              />
              <Input
                label="Building size (m²)"
                type="number"
                min={0}
                value={buildingAreaSqm}
                onChange={(e) => setBuildingAreaSqm(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Bedrooms"
                type="number"
                min={0}
                value={bedrooms}
                onChange={(e) => setBedrooms(e.target.value)}
              />
              <Select
                label="Condition"
                placeholder="Not specified"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                options={CONDITIONS.map((c) => ({ value: c, label: c.replace(/_/g, " ") }))}
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={aiEnrichment}
            onChange={(e) => setAiEnrichment(e.target.checked)}
          />
          Enable AI narrative enrichment
        </label>

        {validationError && (
          <p role="alert" className="text-sm text-red-700">
            {validationError}
          </p>
        )}

        {mutation.isError && !isUnauthorizedError(mutation.error) && (
          <p role="alert" className="text-sm text-red-700">
            {mutation.error instanceof ApiClientError
              ? mutation.error.message
              : "Something went wrong while generating the valuation."}
          </p>
        )}

        {outcome && !outcome.persisted && (
          <p className="text-sm text-stone-600" data-testid="insufficient-data-message">
            Not enough comparable market data was found to generate a valuation for this
            property.
          </p>
        )}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner label="Generating…" /> : "Generate valuation"}
        </Button>
      </form>
    </main>
  );
}
