import { Badge } from "@/components/ui/Badge";
import type { DiscoveryResult } from "@/lib/api/types";

/**
 * "Primary property image/placeholder" — this platform has no property
 * image upload/storage pipeline (the `media` module has been scaffolded
 * since Task 1 but never implemented), so every card renders a plain
 * placeholder rather than a real photo. Not an oversight specific to
 * this task; there is nothing to fetch yet.
 */
function ImagePlaceholder() {
  return (
    <div
      className="flex h-40 w-full items-center justify-center rounded-t-lg bg-stone-100 text-stone-400"
      aria-label="No property image available"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="h-10 w-10"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
        />
      </svg>
    </div>
  );
}

function formatPrice(price: number, currency: string): string {
  return `${Math.round(price).toLocaleString()} ${currency}`;
}

function formatPricePerSqm(value: number | null, currency: string): string | null {
  if (value === null) return null;
  return `${Math.round(value).toLocaleString()} ${currency}/m²`;
}

export interface PropertyCardProps {
  result: DiscoveryResult;
  locationName?: string;
  onSelect?: (result: DiscoveryResult) => void;
}

export function PropertyCard({ result, locationName, onSelect }: PropertyCardProps) {
  const pricePerSqm =
    result.pricePerSqm.perBuildingSqm ?? result.pricePerSqm.perLandSqm ?? null;
  const area = result.buildingAreaSqm ?? result.landAreaSqm;
  const title = `${result.listingType === "sale" ? "For Sale" : "For Rent"}${
    locationName ? ` in ${locationName}` : ""
  }`;

  return (
    <article
      className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md"
      data-testid="property-card"
    >
      <button
        type="button"
        onClick={() => onSelect?.(result)}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
      >
        <ImagePlaceholder />
        <div className="flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          {locationName && <p className="text-xs text-stone-500">{locationName}</p>}

          <p className="text-lg font-bold text-stone-900">
            {formatPrice(result.price, result.currency)}
          </p>

          {pricePerSqm !== null && (
            <p className="text-xs text-stone-500">
              {formatPricePerSqm(pricePerSqm, result.currency)}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge tone={result.listingType === "sale" ? "info" : "success"}>
              {result.listingType === "sale" ? "Sale" : "Rent"}
            </Badge>
            {result.bedrooms !== null && <Badge>{result.bedrooms} bed</Badge>}
            {result.bathrooms !== null && <Badge>{result.bathrooms} bath</Badge>}
            {area !== null && <Badge>{Math.round(area)} m²</Badge>}
            {result.negotiable && <Badge tone="warning">Negotiable</Badge>}
          </div>
        </div>
      </button>
    </article>
  );
}
