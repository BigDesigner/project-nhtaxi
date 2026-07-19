import { z } from "@hono/zod-openapi";

// Wire contract uses dollars (not the cents the DB stores internally, L8) —
// friendlier for a settings screen; the route layer converts both ways.
export const PricingConfigSchema = z
  .object({
    id: z.string(),
    cityId: z.string().nullable(),
    baseFare: z.number().nonnegative(),
    perMile: z.number().nonnegative(),
    // Faz 5b — GNN LLC's own revenue model, separate from the ride fare above.
    driverUsagePerMinute: z.number().nonnegative(),
    driverCommissionPercent: z.number().nonnegative().max(100),
    currency: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PricingConfig");

export const UpdatePricingConfigRequestSchema = z
  .object({
    baseFare: z.number().nonnegative().multipleOf(0.01),
    perMile: z.number().nonnegative().multipleOf(0.01),
    // Faz 5b — optional so an admin UI can edit ride pricing and GNN LLC's
    // own usage fee/commission independently without resending everything.
    driverUsagePerMinute: z.number().nonnegative().multipleOf(0.01).optional(),
    driverCommissionPercent: z.number().nonnegative().max(100).optional(),
  })
  .openapi("UpdatePricingConfigRequest");
