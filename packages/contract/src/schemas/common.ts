import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "NotFound" }),
    message: z.string().openapi({ example: "Resource not found" }),
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    environment: z.string(),
  })
  .openapi("HealthResponse");
