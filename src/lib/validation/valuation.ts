import { z } from "zod";

export const estimateValuationSchema = z.object({
  propertyId: z.string().uuid("propertyId must be a valid UUID."),
});

export type EstimateValuationRequest = z.infer<typeof estimateValuationSchema>;

export const analyzeListingPriceSchema = z.object({
  propertyId: z.string().uuid("propertyId must be a valid UUID."),
  askingPrice: z
    .number()
    .positive("askingPrice must be greater than zero.")
    .max(1_000_000_000_000),
});

export type AnalyzeListingPriceRequest = z.infer<typeof analyzeListingPriceSchema>;

export const aiReportRequestSchema = z.object({
  propertyId: z.string().uuid("propertyId must be a valid UUID."),
});

export type AiReportRequest = z.infer<typeof aiReportRequestSchema>;
