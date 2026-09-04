import { z } from "zod";

/**
 * Three mutually-exclusive input modes, per the Task 8 spec: propertyId,
 * listingId, or direct parameters. `propertyTypeId` is required for the
 * direct-parameters mode beyond what the spec literally listed — see
 * docs/search-and-b2b-domain.md for why.
 */
export const evaluateListingSchema = z
  .object({
    propertyId: z.string().uuid().optional(),
    listingId: z.string().uuid().optional(),
    askingPrice: z.number().positive().max(1_000_000_000_000).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    buildingSize: z.number().positive().optional(),
    propertyTypeId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      const hasProperty = data.propertyId !== undefined;
      const hasListing = data.listingId !== undefined;
      const hasDirect =
        data.latitude !== undefined ||
        data.longitude !== undefined ||
        data.buildingSize !== undefined ||
        data.propertyTypeId !== undefined;
      // Exactly one mode.
      return [hasProperty, hasListing, hasDirect].filter(Boolean).length === 1;
    },
    {
      message:
        "Provide exactly one of: propertyId, listingId, or direct parameters (latitude, longitude, buildingSize, propertyTypeId).",
    }
  )
  .refine((data) => data.propertyId === undefined || data.askingPrice !== undefined, {
    message: "askingPrice is required when propertyId is provided.",
  })
  .refine(
    (data) => {
      const usingDirect =
        data.latitude !== undefined ||
        data.longitude !== undefined ||
        data.buildingSize !== undefined ||
        data.propertyTypeId !== undefined;
      if (!usingDirect) return true;
      return (
        data.latitude !== undefined &&
        data.longitude !== undefined &&
        data.buildingSize !== undefined &&
        data.propertyTypeId !== undefined &&
        data.askingPrice !== undefined
      );
    },
    {
      message:
        "Direct-parameters mode requires all of: latitude, longitude, buildingSize, propertyTypeId, and askingPrice.",
    }
  );

export type EvaluateListingRequest = z.infer<typeof evaluateListingSchema>;
