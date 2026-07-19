import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { driverProfilesTable } from "./drivers";

export const SESSION_CLOSE_REASONS = ["OFFLINE_TOGGLE", "STALE_TIMEOUT", "ADMIN_FORCE_CLOSE"] as const;
export type SessionCloseReason = (typeof SESSION_CLOSE_REASONS)[number];

// Faz 5b — a continuous span of a driver's non-OFFLINE app time (opened/
// closed only by the OFFLINE<->non-OFFLINE toggle in driver_profile.ts, or
// by the stale-session cron sweep). Billed per minute via pricing_config's
// driverUsagePerMinuteCents, regardless of whether any trip was completed.
export const driverSessionsTable = sqliteTable(
  "driver_sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    endedAt: integer("ended_at", { mode: "timestamp" }), // null = still open
    durationMinutes: integer("duration_minutes"),
    chargeCents: integer("charge_cents"),
    closedReason: text("closed_reason", { enum: SESSION_CLOSE_REASONS }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_driver_sessions_driver_id").on(table.driverId),
    index("idx_driver_sessions_driver_open").on(table.driverId, table.endedAt),
    check(
      "chk_driver_sessions_closed_reason",
      sql`${table.closedReason} is null or ${table.closedReason} in ('OFFLINE_TOGGLE','STALE_TIMEOUT','ADMIN_FORCE_CLOSE')`
    ),
  ]
);

export type DriverSession = typeof driverSessionsTable.$inferSelect;
export type InsertDriverSession = typeof driverSessionsTable.$inferInsert;
