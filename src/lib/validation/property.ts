import { z } from "zod";

const currentYear = new Date().getFullYear();

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const conditionSchema = z.enum([
  "new",
  "excellent",
  "good",
  "needs_renovation",
  "under_construction",
]);

const constructionStatusSchema = z.enum(["completed", "under_construction", "planned"]);

/** Shared by create/update — the physical-attribute fields of a Property. */
const propertyDetailFields = {
  landAreaSqm: z.number().positive().max(10_000_000).optional().nullable(),
  buildingAreaSqm: z.number().positive().max(1_000_000).optional().nullable(),
  bedrooms: z.number().int().min(0).max(100).optional().nullable(),
  bathrooms: z.number().int().min(0).max(100).optional().nullable(),
  parkingSpaces: z.number().int().min(0).max(1000).optional().nullable(),
  floor: z.number().int().min(-10).max(200).optional().nullable(),
  yearBuilt: z.number().int().min(1800).max(currentYear + 1).optional().nullable(),
  condition: conditionSchema.optional().nullable(),
  constructionStatus: constructionStatusSchema.optional().nullable(),
  displayAddress: z.string().trim().max(500).optional().nullable(),
  landmark: z.string().trim().max(300).optional().nullable(),
  addressDescription: z.string().trim().max(1000).optional().nullable(),
};

export const createPropertySchema = z.object({
  locationNodeId: z.string().uuid("locationNodeId must be a valid UUID."),
  propertyTypeId: z.string().uuid("propertyTypeId must be a valid UUID."),
  coordinates: coordinatesSchema.optional().nullable(),
  ...propertyDetailFields,
});

export type CreatePropertyRequest = z.infer<typeof createPropertySchema>;

/**
 * All fields optional — a PATCH only touches what's present. Does not
 * include `locationNodeId`/`propertyTypeId` (re-parenting a property to a
 * different location/type is a bigger operation than a details edit;
 * not supported by this endpoint) or `coordinates`/publication status
 * (each has its own dedicated schema/endpoint below, since they have
 * different authorization/validation shapes).
 */
export const updatePropertyDetailsSchema = z
  .object(propertyDetailFields)
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Provide at least one field to update.",
  });

export type UpdatePropertyDetailsRequest = z.infer<typeof updatePropertyDetailsSchema>;

export const updatePropertyCoordinatesSchema = z.object({
  coordinates: coordinatesSchema.nullable(),
});

export type UpdatePropertyCoordinatesRequest = z.infer<
  typeof updatePropertyCoordinatesSchema
>;

export const publicationStatusSchema = z.enum(["draft", "published", "archived"]);

export const updatePublicationStatusSchema = z.object({
  publicationStatus: publicationStatusSchema,
});

export type UpdatePublicationStatusRequest = z.infer<
  typeof updatePublicationStatusSchema
>;

/**
 * Query-string search params arrive as strings — `z.coerce` handles the
 * string -> number/boolean conversion before the range/type checks run.
 * `near` fields are individually optional at the schema level; the
 * service layer requires all three (latitude, longitude, radiusMeters)
 * together or none, since a partial "near" filter is meaningless.
 */
export const searchPropertySchema = z.object({
  locationNodeId: z.string().uuid().optional(),
  propertyTypeId: z.string().uuid().optional(),
  minBedrooms: z.coerce.number().int().min(0).optional(),
  maxBedrooms: z.coerce.number().int().min(0).optional(),
  minLandAreaSqm: z.coerce.number().positive().optional(),
  maxLandAreaSqm: z.coerce.number().positive().optional(),
  minBuildingAreaSqm: z.coerce.number().positive().optional(),
  maxBuildingAreaSqm: z.coerce.number().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().positive().max(200_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchPropertyRequest = z.infer<typeof searchPropertySchema>;
