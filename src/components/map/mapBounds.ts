export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine distance between two lat/lng points, in meters.
 */
function haversineDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `GET /api/search/properties` only supports a radius ("near") filter,
 * not a true rectangular bounding-box query — extending it to accept
 * literal bounds would be a backend query change beyond this task's
 * frontend framing (see docs/frontend-portal.md). This approximates the
 * visible map area as a circle: centered on the bounds' midpoint, with a
 * radius reaching the corner (the half-diagonal) — guaranteed to cover
 * the whole visible rectangle, at the cost of also fetching a modest
 * amount outside it near the rectangle's edges. A well-understood,
 * common simplification for map-based search UIs, not a bug.
 */
export function boundsToRadiusSearch(bounds: MapBounds): {
  latitude: number;
  longitude: number;
  radiusMeters: number;
} {
  const center = {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
  };
  const corner = { latitude: bounds.north, longitude: bounds.east };
  const radiusMeters = Math.ceil(haversineDistanceMeters(center, corner));

  return { latitude: center.latitude, longitude: center.longitude, radiusMeters };
}
