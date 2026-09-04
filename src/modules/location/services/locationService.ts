import {
  prismaLocationRepository,
  type LocationRepository,
  type LocationNodeRecord,
} from "../repositories/locationRepository";

/**
 * Factory, not a bare singleton — same DI pattern as every other service
 * in this codebase.
 */
export function createLocationService(
  repository: LocationRepository = prismaLocationRepository
) {
  return {
    async listLocations(level?: string): Promise<LocationNodeRecord[]> {
      return repository.listAll(level);
    },
  };
}

export const locationService = createLocationService();
