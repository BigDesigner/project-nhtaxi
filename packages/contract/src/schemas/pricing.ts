import { z } from "@hono/zod-openapi";

// Wire contract uses dollars (not the cents the DB stores internally, L8) —
// friendlier for a settings screen; the route layer converts both ways.
export const PricingConfigSchema = z
  .object({
    id: z.string(),
    cityId: z.string().nullable(),
    baseFare: z.number().nonnegative(),
    perMile: z.number().nonnegative(),
    currency: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PricingConfig");

export const UpdatePricingConfigRequestSchema = z
  .object({
    baseFare: z.number().nonnegative().multipleOf(0.01),
    perMile: z.number().nonnegative().multipleOf(0.01),
  })
  .openapi("UpdatePricingConfigRequest");
