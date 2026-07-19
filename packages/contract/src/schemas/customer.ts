import { z } from "@hono/zod-openapi";

export const CustomerProfileResponseSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    preferredPaymentMethod: z.string().nullable(),
    totalTrips: z.number().int(),
  })
  .openapi("CustomerProfileResponse");
