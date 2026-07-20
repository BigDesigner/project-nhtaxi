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

// How the trip came into being. CUSTOMER_APP is the passenger-requested
// auto-dispatch flow; ADMIN_ASSIGNED is a trip an admin hand-picks a driver
// for directly; DRIVER_REFERRAL is one the driver opened at the kerb, from
// their own GPS, for a passenger the office sent them by phone with no
// booking behind it.
//
// Note this says nothing about commission — see referralSource for that.
export const TRIP_ORIGINS = ["CUSTOMER_APP", "ADMIN_ASSIGNED", "DRIVER_REFERRAL"] as const;

// What decides whether a trip owes GNN LLC commission. See REFERRAL_SOURCES
// in packages/db for the full reasoning — in short, drivers pay rent for time
// on the app and ordinary dispatch work is what that rent buys, so only jobs
// GNN LLC actually referred carry a cut.
export const REFERRAL_SOURCES = ["NONE", "ADMIN_ASSIGNED", "DRIVER_DECLARED", "ADMIN_MARKED"] as const;

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
    // Faz 7 — the passenger picked this driver off the map. It's a
    // preference, not a reservation: dispatch offers the trip to them first
    // and falls back to the nearest available driver if they decline or
    // don't answer, so a passenger is never left waiting on one person.
    preferredDriverId: z.string().uuid().optional(),
  })
  .openapi("CreateTripRequest");

export const UpdateTripStatusRequestSchema = z
  .object({
    status: z.enum(CLIENT_SETTABLE_TRIP_STATUSES),
    // Set by the driver when accepting: "GNN LLC referred this job to me".
    // Only read on the DRIVER_ACCEPTED transition, and only capable of
    // turning a referral *on* — a driver cannot clear one the office set,
    // which would let them opt out of commission after the fact.
    gnnReferred: z.boolean().optional(),
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

// Faz 7 — quote a fare *before* booking (plan §4.9). Same pickup/dropoff
// shape as CreateTripRequest minus everything that only matters once a trip
// actually exists.
export const EstimateTripRequestSchema = z
  .object({
    pickupLat: z.number().min(-90).max(90),
    pickupLng: z.number().min(-180).max(180),
    dropoffLat: z.number().min(-90).max(90),
    dropoffLng: z.number().min(-180).max(180),
  })
  .openapi("EstimateTripRequest");

export const EstimateTripResponseSchema = z
  .object({
    distanceMiles: z.number(),
    estimatedFare: z.number(),
    currency: z.string(),
  })
  .openapi("EstimateTripResponse");

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
    referralSource: z.enum(REFERRAL_SOURCES),
    // Driver-search progress. The client renders its countdown from
    // nextSearchAt rather than its own timer, so every screen showing this
    // trip counts down to the same instant.
    searchAttempts: z.number().int(),
    nextSearchAt: z.string().nullable(),
    maxSearchAttempts: z.number().int(),
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

// Admin has the last word on whether a job was referred: nobody volunteers to
// pay commission, and the office knows what it handed out.
export const SetTripReferralRequestSchema = z
  .object({
    referred: z.boolean(),
  })
  .openapi("SetTripReferralRequest");

// Driver/admin-only — deliberately not on TripResponseSchema. See
// packages/db/src/schema/trips.ts for why: this is exposed through its own
// endpoint precisely so a passenger-facing response can never carry it.
export const TripPathVerificationResponseSchema = z
  .object({
    status: z.enum(["NOT_CHECKED", "MATCHED", "MISMATCHED"]),
    deviationMiles: z.number().nullable(),
  })
  .openapi("TripPathVerificationResponse");

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
