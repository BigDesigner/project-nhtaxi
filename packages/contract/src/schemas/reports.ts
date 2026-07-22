import { z } from "@hono/zod-openapi";
import { PAYMENT_METHODS, REFERRAL_SOURCES, TRIP_STATUSES } from "./trips";

// ─── Admin trip/fare report (L16 — tax + security reporting) ───────────────
export const TripReportQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(TRIP_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const TripReportRowSchema = z
  .object({
    tripId: z.string(),
    status: z.enum(TRIP_STATUSES),
    requestedAt: z.string(),
    completedAt: z.string().nullable(),
    driverId: z.string().nullable(),
    driverName: z.string().nullable(),
    customerId: z.string(),
    customerName: z.string(),
    referralSource: z.enum(REFERRAL_SOURCES),
    distanceMiles: z.number().nullable(),
    estimatedFare: z.number().nullable(),
    finalFare: z.number().nullable(),
    currency: z.string(),
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .openapi("TripReportRow");

// ─── Admin audit log viewing (L16 — security reporting) ────────────────────
export const AuditLogQuerySchema = z.object({
  entity: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AuditLogEntrySchema = z
  .object({
    id: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    action: z.string(),
    actorId: z.string().nullable(),
    actorRole: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    ipAddress: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AuditLogEntry");

// ─── Driver's own earnings summary (4.10 — own tax record) ─────────────────
export const DriverEarningsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const DriverEarningsTripSchema = z
  .object({
    tripId: z.string(),
    completedAt: z.string().nullable(),
    distanceMiles: z.number().nullable(),
    fare: z.number().nullable(),
    currency: z.string(),
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .openapi("DriverEarningsTrip");

export const DriverEarningsSummarySchema = z
  .object({
    tripCount: z.number().int(),
    totalEarnings: z.number(),
    currency: z.string(),
    trips: z.array(DriverEarningsTripSchema),
  })
  .openapi("DriverEarningsSummary");

// ─── Admin: earnings across drivers (bulk + individual) ────────────────────
// The mirror of DriverEarningsSummary but for the office: one totals row per
// driver, so an admin can hand a driver their figure at a meeting or run the
// whole fleet at once. `driverId` narrows it to a single driver.
export const AdminDriverEarningsQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const AdminDriverEarningsRowSchema = z
  .object({
    driverId: z.string(),
    driverName: z.string(),
    tripCount: z.number().int(),
    totalEarnings: z.number(),
    currency: z.string(),
  })
  .openapi("AdminDriverEarningsRow");

// ─── Period financial summary (the tax-filing backbone) ────────────────────
// GNN LLC's own income is rent (usage fees) + commission; the gross fares
// passengers paid belong to the drivers, not GNN, so they sit in a separate
// informational block. Every figure is a sum over [from, to] (omit either for
// an open-ended range).
export const FinancialSummaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Per-driver contribution to the period, so the totals can be traced to a name.
export const FinancialSummaryRowSchema = z
  .object({
    driverId: z.string(),
    driverName: z.string(),
    usageFeesCharged: z.number(),
    commissionCharged: z.number(),
    gnnRevenue: z.number(),
    cashCollected: z.number(),
    completedTripCount: z.number().int(),
    grossFares: z.number(),
  })
  .openapi("FinancialSummaryRow");

export const FinancialSummaryResponseSchema = z
  .object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    currency: z.string(),
    // GNN LLC income
    usageFeesCharged: z.number(),
    commissionCharged: z.number(),
    gnnGrossRevenue: z.number(),
    cashCollected: z.number(),
    // Informational — the drivers' own turnover, not GNN's money
    completedTripCount: z.number().int(),
    grossFares: z.number(),
    drivers: z.array(FinancialSummaryRowSchema),
  })
  .openapi("FinancialSummaryResponse");
