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
    currentLat: real("current_lat"),
    currentLng: real("current_lng"),
    lastSeen: integer("last_seen", { mode: "timestamp" }),
    cityId: text("city_id").references(() => citiesTable.id),
    rating: real("rating"),
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
