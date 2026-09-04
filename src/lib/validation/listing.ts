import { z } from "zod";

/**
 * Not an exhaustive ISO-4217 list — just the currencies this platform
 * actually expects right now. Deliberately a Zod-level allow-list, not a
 * database enum (see prisma/schema.prisma's comment on Listing.currency
 * and docs/listing-domain.md): adding a currency later is a one-line
 * change here, not a migration.
 */
const currencySchema = z.enum(["ETB", "USD"]).default("ETB");

const listingTypeSchema = z.enum(["sale", "rent"]);
const listingStatusSchema = z.enum([
  "draft",
  "active",
  "sold",
  "rented",
  "expired",
  "archived",
]);

/**
 * Structured but intentionally loose — `contactInfo` is meant to hold
 * whatever a listing needs (phone, email, preferred contact method,
 * agency name) without this schema needing to change every time a new
 * field is wanted. Kept as a plain JSON object, size-capped defensively.
 */
const contactInfoSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((obj) => JSON.stringify(obj).length <= 5000, {
    message: "contactInfo is too large.",
  })
  .optional()
  .nullable();

export const createListingSchema = z.object({
  propertyId: z.string().uuid("propertyId must be a valid UUID."),
  listingType: listingTypeSchema,
  price: z.number().positive("price must be greater than zero.").max(1_000_000_000_000),
  currency: currencySchema.optional(),
  negotiable: z.boolean().optional(),
  contactInfo: contactInfoSchema,
});

export type CreateListingRequest = z.infer<typeof createListingSchema>;

export const updateListingDetailsSchema = z
  .object({
    price: z.number().positive().max(1_000_000_000_000).optional(),
    currency: currencySchema.optional(),
    negotiable: z.boolean().optional(),
    contactInfo: contactInfoSchema,
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Provide at least one field to update.",
  });

export type UpdateListingDetailsRequest = z.infer<typeof updateListingDetailsSchema>;

export const updateListingStatusSchema = z.object({
  status: listingStatusSchema,
});

export type UpdateListingStatusRequest = z.infer<typeof updateListingStatusSchema>;

/**
 * Query-string search params — same `z.coerce` pattern as
 * lib/validation/property.ts's searchPropertySchema, and the same
 * all-or-nothing "near" contract (validated at the route layer, since
 * Zod can't easily express "these three or none" as a single rule
 * without becoming hard to read).
 */
export const searchListingSchema = z.object({
  listingType: listingTypeSchema.optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  locationNodeId: z.string().uuid().optional(),
  propertyTypeId: z.string().uuid().optional(),
  minBedrooms: z.coerce.number().int().min(0).optional(),
  maxBedrooms: z.coerce.number().int().min(0).optional(),
  minBuildingAreaSqm: z.coerce.number().positive().optional(),
  maxBuildingAreaSqm: z.coerce.number().positive().optional(),
  minLandAreaSqm: z.coerce.number().positive().optional(),
  maxLandAreaSqm: z.coerce.number().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().positive().max(200_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchListingRequest = z.infer<typeof searchListingSchema>;
