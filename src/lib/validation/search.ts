import { z } from "zod";

export const searchDiscoverySchema = z.object({
  locationNodeId: z.string().uuid().optional(),
  propertyType: z.string().uuid().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  listingType: z.enum(["sale", "rent"]).optional(),
  minBedrooms: z.coerce.number().int().min(0).optional(),
  minBathrooms: z.coerce.number().int().min(0).optional(),
  minBuildingSize: z.coerce.number().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().positive().max(200_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchDiscoveryRequest = z.infer<typeof searchDiscoverySchema>;

export const neighborhoodStatsSchema = z.object({
  locationNodeId: z.string().uuid("locationNodeId must be a valid UUID."),
});

export type NeighborhoodStatsRequest = z.infer<typeof neighborhoodStatsSchema>;
