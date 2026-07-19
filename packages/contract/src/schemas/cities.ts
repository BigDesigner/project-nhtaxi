import { z } from "@hono/zod-openapi";

export const CitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    country: z.string(),
    state: z.string().nullable(),
    timezone: z.string(),
    isActive: z.boolean(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  })
  .openapi("City");

export const CreateCityRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    country: z.string().min(1).max(100).default("US"),
    state: z.string().max(100).optional(),
    timezone: z.string().min(1).max(100).default("America/New_York"),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .openapi("CreateCityRequest");
