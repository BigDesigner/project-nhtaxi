import { sqliteTable, text, integer, real, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { driverProfilesTable } from "./drivers";
import { citiesTable } from "./cities";

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
export type TripStatus = (typeof TRIP_STATUSES)[number];

// Faz 5b — cash-only for now (TS-level type only; the CHECK constraints
// below stay as the wider 'cash','card','online' literal SQL so no
// migration is needed — trivially reversible when Stripe returns by
// widening this array again).
export const PAYMENT_METHODS = ["cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Faz 5c — CUSTOMER_APP is the existing passenger-requested/auto-dispatch
// flow; ADMIN_ASSIGNED is a trip an admin hand-picks a driver for directly
// (e.g. a phoned-in booking), which owes GNN LLC a commission (see
// commissionPercent below) instead of the flat usage-time fee alone.
// DRIVER_REFERRAL (a job the driver opens at the kerb for an off-app
// passenger) lands here in the next wave. It is held back deliberately:
// widening this list means rewriting the CHECK constraint below, which in
// SQLite means rebuilding the whole trips table — the exact operation that
// failed twice against the remote D1 and had to be hand-repaired. It gets
// done on its own, with its own migration and nothing else riding on it.
export const TRIP_ORIGINS = ["CUSTOMER_APP", "ADMIN_ASSIGNED"] as const;
export type TripOrigin = (typeof TRIP_ORIGINS)[number];

/**
 * Whether GNN LLC put this job in front of the driver — and so whether it
 * owes commission.
 *
 * This exists because commission cannot be inferred from `origin`. GNNcab is
 * not a platform that takes a cut of everything: drivers pay rent for time on
 * the app, and finding work through ordinary dispatch is what that rent buys.
 * Commission is owed only when GNN LLC *referred* the job, and a referral can
 * arrive by three different routes:
 *
 *  - ADMIN_ASSIGNED  the office picked the driver in the admin panel;
 *  - DRIVER_DECLARED the office phoned the passenger ("download the app, ask
 *                    for Dan") so the trip arrives looking like any other
 *                    booking — only the driver knows, and ticks the box;
 *  - ADMIN_MARKED    the office set it afterwards.
 *
 * NONE is the ordinary case and carries no commission.
 *
 * ADMIN_MARKED is deliberately last-word: nobody volunteers to pay
 * commission, so a system resting purely on the driver's tick would quietly
 * lose money. The office knows which jobs it referred, so the office can
 * always correct the record — and every change is audit-logged.
 */
export const REFERRAL_SOURCES = ["NONE", "ADMIN_ASSIGNED", "DRIVER_DECLARED", "ADMIN_MARKED"] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const tripsTable = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // Faz 5c — nullable: an admin-assigned trip may be a walk-in/phone
    // booking with no registered account (guestName/guestPhone instead).
    customerId: text("customer_id").references(() => usersTable.id),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    driverId: text("driver_id").references(() => driverProfilesTable.id),
    cityId: text("city_id").references(() => citiesTable.id),
    pickupLat: real("pickup_lat").notNull(),
    pickupLng: real("pickup_lng").notNull(),
    pickupAddress: text("pickup_address").notNull(),
    // Faz 5c — nullable: an admin-assigned trip may not know the
    // destination until the driver has picked the passenger up in person
    // and asks them; the driver fills it in when marking the ride started.
    dropoffLat: real("dropoff_lat"),
    dropoffLng: real("dropoff_lng"),
    dropoffAddress: text("dropoff_address"),
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("REQUESTED"),
    origin: text("origin", { enum: TRIP_ORIGINS }).notNull().default("CUSTOMER_APP"),
    /** Drives commission. See REFERRAL_SOURCES above for why `origin` can't. */
    referralSource: text("referral_source", { enum: REFERRAL_SOURCES }).notNull().default("NONE"),
    // Faz 7 — how many times dispatch has swept for a driver, and when the
    // next sweep is due. Driven by DispatchCoordinator's Alarm so the search
    // continues even with the app closed; the passenger UI renders a
    // countdown straight off nextSearchAt, which keeps every screen showing
    // the same number without any client-side clock of its own.
    searchAttempts: integer("search_attempts").notNull().default(0),
    nextSearchAt: integer("next_search_at", { mode: "timestamp" }),
    // Snapshotted from pricing_config at admin-assignment time (ADMIN_ASSIGNED
    // trips only) so a later change to the global rate never retroactively
    // changes what was disclosed to/accepted by the driver for this trip.
    commissionPercent: real("commission_percent"),
    distanceMiles: real("distance_miles"),
    // Money stored as integer cents (USD) — avoids float rounding drift in tax/reporting.
    estimatedFareCents: integer("estimated_fare_cents"),
    finalFareCents: integer("final_fare_cents"),
    currency: text("currency").notNull().default("USD"),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull().default("cash"),
    cancellationReason: text("cancellation_reason"),
    notes: text("notes"),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    assignedAt: integer("assigned_at", { mode: "timestamp" }),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_trips_customer_id").on(table.customerId),
    index("idx_trips_driver_id").on(table.driverId),
    index("idx_trips_status").on(table.status),
    check(
      "chk_trips_status",
      sql`${table.status} in ('REQUESTED','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_REJECTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','TRIP_STARTED','TRIP_COMPLETED','TRIP_CANCELLED','DRIVER_NO_RESPONSE','TIMEOUT')`
    ),
    check("chk_trips_payment_method", sql`${table.paymentMethod} in ('cash','card','online')`),
    check("chk_trips_origin", sql`${table.origin} in ('CUSTOMER_APP','ADMIN_ASSIGNED')`),
  ]
);

export type Trip = typeof tripsTable.$inferSelect;
export type InsertTrip = typeof tripsTable.$inferInsert;

// Chronological audit trail of every status transition a trip goes through.
export const tripEventsTable = sqliteTable(
  "trip_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: text("trip_id")
      .notNull()
      .references(() => tripsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("idx_trip_events_trip_id").on(table.tripId)]
);

export type TripEvent = typeof tripEventsTable.$inferSelect;
export type InsertTripEvent = typeof tripEventsTable.$inferInsert;
