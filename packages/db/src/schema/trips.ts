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

export const PAYMENT_METHODS = ["cash", "card", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const tripsTable = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    customerId: text("customer_id")
      .notNull()
      .references(() => usersTable.id),
    driverId: text("driver_id").references(() => driverProfilesTable.id),
    cityId: text("city_id").references(() => citiesTable.id),
    pickupLat: real("pickup_lat").notNull(),
    pickupLng: real("pickup_lng").notNull(),
    pickupAddress: text("pickup_address").notNull(),
    dropoffLat: real("dropoff_lat").notNull(),
    dropoffLng: real("dropoff_lng").notNull(),
    dropoffAddress: text("dropoff_address").notNull(),
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("REQUESTED"),
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
