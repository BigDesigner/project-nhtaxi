import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { driverProfilesTable } from "./drivers";
import { tripsTable } from "./trips";

// Faz 5c — one row per completed ADMIN_ASSIGNED trip, snapshotting the rate
// actually applied (mirrors trips.commissionPercent) so this ledger stays
// accurate even if the global pricing_config rate changes later.
export const driverTripCommissionsTable = sqliteTable(
  "driver_trip_commissions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    tripId: text("trip_id")
      .notNull()
      .references(() => tripsTable.id, { onDelete: "cascade" }),
    fareCents: integer("fare_cents").notNull(),
    commissionPercent: real("commission_percent").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("idx_driver_trip_commissions_driver_id").on(table.driverId)]
);

export type DriverTripCommission = typeof driverTripCommissionsTable.$inferSelect;
export type InsertDriverTripCommission = typeof driverTripCommissionsTable.$inferInsert;
