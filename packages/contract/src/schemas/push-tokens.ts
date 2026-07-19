import { z } from "@hono/zod-openapi";

// Faz 6 — matches packages/db's DEVICE_PLATFORMS (scaffolded in Faz 0's
// schema skeleton, ios/android only — the web admin panel isn't a push target).
export const DEVICE_PLATFORMS = ["ios", "android"] as const;

export const RegisterPushTokenRequestSchema = z
  .object({
    token: z.string().min(1).max(4096),
    platform: z.enum(DEVICE_PLATFORMS),
  })
  .openapi("RegisterPushTokenRequest");

export const UnregisterPushTokenRequestSchema = z
  .object({
    token: z.string().min(1).max(4096),
  })
  .openapi("UnregisterPushTokenRequest");

export const PushTokenAckSchema = z
  .object({
    status: z.literal("ok"),
  })
  .openapi("PushTokenAck");
