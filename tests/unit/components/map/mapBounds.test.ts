import { describe, expect, it } from "vitest";
import { boundsToRadiusSearch } from "@/components/map/mapBounds";

describe("boundsToRadiusSearch", () => {
  it("centers on the bounds' midpoint", () => {
    const result = boundsToRadiusSearch({ north: 9.02, south: 8.98, east: 38.82, west: 38.78 });

    expect(result.latitude).toBeCloseTo(9.0, 5);
    expect(result.longitude).toBeCloseTo(38.8, 5);
  });

  it("produces a radius that covers the whole bounding box, not just its width or height", () => {
    const result = boundsToRadiusSearch({ north: 9.02, south: 8.98, east: 38.82, west: 38.78 });

    expect(result.radiusMeters).toBeGreaterThan(2_800);
    expect(result.radiusMeters).toBeLessThan(3_500);
  });

  it("scales the radius up for a larger bounding box", () => {
    const small = boundsToRadiusSearch({ north: 9.001, south: 8.999, east: 38.801, west: 38.799 });
    const large = boundsToRadiusSearch({ north: 9.1, south: 8.9, east: 38.9, west: 38.7 });

    expect(large.radiusMeters).toBeGreaterThan(small.radiusMeters);
  });

  it("returns a sensible small radius for a tiny (near-zero-area) box", () => {
    const result = boundsToRadiusSearch({
      north: 9.0001,
      south: 8.9999,
      east: 38.8001,
      west: 38.7999,
    });

    expect(result.radiusMeters).toBeGreaterThan(0);
    expect(result.radiusMeters).toBeLessThan(100);
  });
});
