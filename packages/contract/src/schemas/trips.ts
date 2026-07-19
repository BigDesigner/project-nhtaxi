import { z } from "@hono/zod-openapi";

export const TRIP_STATUSES = [
  "REQUESTED",
  "DRIVER_ASSIGNED",
  "DRIVER_ACCEPTED",
  "DRIVER_REJECTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
  "TRIP_CANCELLED",
  "DRIVER_NO_RESPONSE",
  "TIMEOUT",
] as const;

// Driver-triggerable transitions only — REQUESTED/DRIVER_ASSIGNED/
// DRIVER_NO_RESPONSE/TIMEOUT are system/dispatch-controlled, never posted
// directly by a client.
export const CLIENT_SETTABLE_TRIP_STATUSES = [
  "DRIVER_ACCEPTED",
  "DRIVER_REJECTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
] as const;

// Faz 5b — cash-only for now; Stripe/in-app collection (card/online) is
// deferred indefinitely, no committed phase. Contract-layer restriction
// only (the DB's CHECK constraint stays as-is — zero risk, trivially
// reversible by widening this array again when Stripe returns).
export const PAYMENT_METHODS = ["cash"] as const;

// Faz 5c — CUSTOMER_APP is the existing passenger-requested/auto-dispatch
// flow; ADMIN_ASSIGNED is a trip an admin hand-picks a driver for directly,
// which owes GNN LLC a commission (see commissionPercent below).
export const TRIP_ORIGINS = ["CUSTOMER_APP", "ADMIN_ASSIGNED"] as const;

export const CreateTripRequestSchema = z
  .object({
    pickupLat: z.number().min(-90).max(90),
    pickupLng: z.number().min(-180).max(180),
    pickupAddress: z.string().min(1).max(500),
    dropoffLat: z.number().min(-90).max(90),
    dropoffLng: z.number().min(-180).max(180),
    dropoffAddress: z.string().min(1).max(500),
    paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
    notes: z.string().max(1000).optional(),
  })
  .openapi("CreateTripRequest");

export const UpdateTripStatusRequestSchema = z
  .object({
    status: z.enum(CLIENT_SETTABLE_TRIP_STATUSES),
    // Faz 5c — only required when transitioning to TRIP_STARTED on a trip
    // that has no dropoff yet (an admin-assigned trip whose destination
    // wasn't known at booking time); ignored otherwise. All-or-nothing.
    dropoffLat: z.number().min(-90).max(90).optional(),
    dropoffLng: z.number().min(-180).max(180).optional(),
    dropoffAddress: z.string().min(1).max(500).optional(),
  })
  .openapi("UpdateTripStatusRequest");

export const CancelTripRequestSchema = z
  .object({
    reason: z.string().min(1).max(500),
  })
  .openapi("CancelTripRequest");

export const TripResponseSchema = z
  .object({
    id: z.string(),
    customerId: z.string().nullable(),
    guestName: z.string().nullable(),
    guestPhone: z.string().nullable(),
    driverId: z.string().nullable(),
    cityId: z.string().nullable(),
    pickupLat: z.number(),
    pickupLng: z.number(),
    pickupAddress: z.string(),
    dropoffLat: z.number().nullable(),
    dropoffLng: z.number().nullable(),
    dropoffAddress: z.string().nullable(),
    status: z.enum(TRIP_STATUSES),
    origin: z.enum(TRIP_ORIGINS),
    // Disclosed to the driver before they accept an ADMIN_ASSIGNED trip —
    // null for ordinary CUSTOMER_APP trips.
    commissionPercent: z.number().nullable(),
    distanceMiles: z.number().nullable(),
    estimatedFare: z.number().nullable(),
    finalFare: z.number().nullable(),
    currency: z.string(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    cancellationReason: z.string().nullable(),
    notes: z.string().nullable(),
    requestedAt: z.string(),
    assignedAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .openapi("TripResponse");

export const TripEventResponseSchema = z
  .object({
    id: z.string(),
    tripId: z.string(),
    status: z.string(),
    actorId: z.string().nullable(),
    actorRole: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("TripEventResponse");
