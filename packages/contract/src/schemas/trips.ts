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
    customerId: z.string(),
    driverId: z.string().nullable(),
    cityId: z.string().nullable(),
    pickupLat: z.number(),
    pickupLng: z.number(),
    pickupAddress: z.string(),
    dropoffLat: z.number(),
    dropoffLng: z.number(),
    dropoffAddress: z.string(),
    status: z.enum(TRIP_STATUSES),
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
