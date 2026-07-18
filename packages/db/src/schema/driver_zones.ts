import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { driverProfilesTable } from "./drivers";
import { zonesTable } from "./zones";

export const driverZoneAssignmentsTable = sqliteTable(
  "driver_zone_assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    zoneId: text("zone_id")
      .notNull()
      .references(() => zonesTable.id, { onDelete: "cascade" }),
    assignedAt: integer("assigned_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [unique("uq_driver_zone").on(t.driverId, t.zoneId)]
);

export type DriverZoneAssignment = typeof driverZoneAssignmentsTable.$inferSelect;
