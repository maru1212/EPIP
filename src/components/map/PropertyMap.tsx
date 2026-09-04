"use client";

import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { DiscoveryResult } from "@/lib/api/types";
import { boundsToRadiusSearch, type MapBounds } from "./mapBounds";

/**
 * Leaflet's default marker icon references relative image paths that
 * break under most bundlers (this is a well-known, long-standing Leaflet
 * + webpack/Turbopack interaction issue, not specific to this project) —
 * pointed at the same CDN this project already uses for other static
 * assets (Task 9's Swagger UI) rather than bundling the icon images as
 * new local assets.
 */
const DEFAULT_ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface BoundsWatcherProps {
  onBoundsChange: (bounds: MapBounds) => void;
  debounceMs: number;
}

/**
 * Must live inside <MapContainer> to access the map instance via
 * `useMapEvents` — this is react-leaflet's established pattern for
 * subscribing to map events, not a custom workaround. Debounces
 * `moveend` (fired on both pan and zoom completion) so a user dragging
 * or scroll-zooming doesn't trigger a request per intermediate frame —
 * the Task 11 spec's explicit "debounced to avoid rate limits"
 * requirement.
 */
function BoundsWatcher({ onBoundsChange, debounceMs }: BoundsWatcherProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const map = useMapEvents({
    moveend() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }, debounceMs);
    },
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}

function formatMarkerPrice(result: DiscoveryResult): string {
  return `${Math.round(result.price).toLocaleString()} ${result.currency}`;
}

function formatMarkerPricePerSqm(result: DiscoveryResult): string | null {
  const value = result.pricePerSqm.perBuildingSqm ?? result.pricePerSqm.perLandSqm;
  if (value === null) return null;
  return `${Math.round(value).toLocaleString()} ${result.currency}/m²`;
}

export interface PropertyMapProps {
  results: DiscoveryResult[];
  center: { latitude: number; longitude: number };
  zoom?: number;
  /**
   * Receives the new radius search derived from the map's visible area
   * whenever the user finishes panning/zooming (see boundsToRadiusSearch
   * — this approximates the rectangular viewport as a circle, since the
   * search API only supports radius search; see mapBounds.ts).
   */
  onViewportChange?: (search: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  }) => void;
  debounceMs?: number;
  onSelectResult?: (result: DiscoveryResult) => void;
}

export function PropertyMap({
  results,
  center,
  zoom = 13,
  onViewportChange,
  debounceMs = 500,
  onSelectResult,
}: PropertyMapProps) {
  const markers = results.filter(
    (
      result
    ): result is DiscoveryResult & {
      coordinates: NonNullable<DiscoveryResult["coordinates"]>;
    } => result.coordinates !== null
  );

  return (
    <MapContainer
      center={[center.latitude, center.longitude]}
      zoom={zoom}
      scrollWheelZoom
      className="h-full w-full rounded-lg"
      data-testid="property-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {onViewportChange && (
        <BoundsWatcher
          debounceMs={debounceMs}
          onBoundsChange={(bounds) => onViewportChange(boundsToRadiusSearch(bounds))}
        />
      )}

      {markers.map((result) => (
        <Marker
          key={result.listingId}
          position={[result.coordinates.latitude, result.coordinates.longitude]}
          icon={DEFAULT_ICON}
          eventHandlers={onSelectResult ? { click: () => onSelectResult(result) } : undefined}
        >
          <Popup>
            <div className="flex flex-col gap-1 text-sm">
              <strong>{formatMarkerPrice(result)}</strong>
              {formatMarkerPricePerSqm(result) && <span>{formatMarkerPricePerSqm(result)}</span>}
              <span>{result.listingType === "sale" ? "For Sale" : "For Rent"}</span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
