import { z } from "@hono/zod-openapi";

// ─── Online-session footprint (day/hour ranges a driver was active) ───────
export const SESSION_CLOSE_REASONS = ["OFFLINE_TOGGLE", "STALE_TIMEOUT", "ADMIN_FORCE_CLOSE"] as const;

export const DriverSessionSchema = z
  .object({
    id: z.string(),
    driverId: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationMinutes: z.number().int().nullable(),
    charge: z.number().nullable(),
    closedReason: z.enum(SESSION_CLOSE_REASONS).nullable(),
  })
  .openapi("DriverSession");

export const DriverSessionQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Cash collections (admin records a driver's in-person payment) ────────
export const RecordCashCollectionRequestSchema = z
  .object({
    amount: z.number().positive().multipleOf(0.01),
    collectedAt: z.coerce.date().optional(),
    notes: z.string().max(1000).optional(),
  })
  .openapi("RecordCashCollectionRequest");

export const DriverCashCollectionSchema = z
  .object({
    id: z.string(),
    driverId: z.string(),
    driverName: z.string(),
    amount: z.number(),
    collectedAt: z.string(),
    collectedByName: z.string(),
    notes: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("DriverCashCollection");

export const DriverCollectionQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Per-trip commission charges (admin-assigned trips only, Faz 5c) ──────
export const DriverCommissionChargeSchema = z
  .object({
    id: z.string(),
    driverId: z.string(),
    driverName: z.string(),
    tripId: z.string(),
    fare: z.number(),
    commissionPercent: z.number(),
    commission: z.number(),
    createdAt: z.string(),
  })
  .openapi("DriverCommissionCharge");

export const DriverCommissionQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Balance reports ───────────────────────────────────────────────────────
// Admin view — one row per driver with any billing activity.
export const DriverBalanceReportRowSchema = z
  .object({
    driverId: z.string(),
    driverName: z.string(),
    usageFeeCharged: z.number(),
    commissionCharged: z.number(),
    totalCharged: z.number(),
    totalCollected: z.number(),
    pendingBalance: z.number(),
    hasOpenSession: z.boolean(),
  })
  .openapi("DriverBalanceReportRow");

// Driver's own view of the same figures (4.10-style parity — no name/id, it's implicitly "mine").
export const DriverOwnBalanceSchema = z
  .object({
    usageFeeCharged: z.number(),
    commissionCharged: z.number(),
    totalCharged: z.number(),
    totalCollected: z.number(),
    pendingBalance: z.number(),
    hasOpenSession: z.boolean(),
  })
  .openapi("DriverOwnBalance");
