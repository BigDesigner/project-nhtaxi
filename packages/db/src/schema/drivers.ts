import { sqliteTable, text, integer, real, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { citiesTable } from "./cities";

export const DRIVER_STATUSES = ["AVAILABLE", "RESERVED", "BUSY", "OFFLINE"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const driverProfilesTable = sqliteTable(
  "driver_profiles",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    licenseNumber: text("license_number"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleYear: integer("vehicle_year"),
    vehicleColor: text("vehicle_color"),
    vehiclePlate: text("vehicle_plate"),
    status: text("status", { enum: DRIVER_STATUSES }).notNull().default("OFFLINE"),
    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    /**
     * R2 object key for the driver's profile photo, under the `avatars/`
     * prefix. Deliberately *not* stored the way driver_documents are: those
     * are identity papers, envelope-encrypted and admin-only. This one is
     * shown to passengers choosing a driver, so it's stored unencrypted and
     * served through an authenticated route that only ever reads `avatars/`.
     * Null until the driver uploads one.
     */
    photoKey: text("photo_key"),
    currentLat: real("current_lat"),
    currentLng: real("current_lng"),
    lastSeen: integer("last_seen", { mode: "timestamp" }),
    cityId: text("city_id").references(() => citiesTable.id),
    /**
     * Headline star average across this driver's rated trips, recomputed from
     * `trip_ratings` on every new rating (lib/ratings.ts). Null until the
     * driver has at least one rating — a driver with no history shows no
     * stars rather than a misleading zero.
     */
    rating: real("rating"),
    /** How many ratings back the average — shown as "4.6 (23 trips)". */
    ratingCount: integer("rating_count").notNull().default(0),
    totalTrips: integer("total_trips").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_driver_profiles_status").on(table.status),
    check("chk_driver_profiles_status", sql`${table.status} in ('AVAILABLE','RESERVED','BUSY','OFFLINE')`),
  ]
);

export type DriverProfile = typeof driverProfilesTable.$inferSelect;
export type InsertDriverProfile = typeof driverProfilesTable.$inferInsert;
