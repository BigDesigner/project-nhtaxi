import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { driverProfilesTable } from "./drivers";
import { usersTable } from "./users";

// Faz 5b — a single lump-sum cash handover from a driver to GNN LLC,
// recorded by an admin against the driver's combined balance (usage-fee +
// commission debt together; a real cash handover isn't naturally split).
export const driverCashCollectionsTable = sqliteTable(
  "driver_cash_collections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    collectedAt: integer("collected_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    collectedBy: text("collected_by")
      .notNull()
      .references(() => usersTable.id),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("idx_driver_cash_collections_driver_id").on(table.driverId)]
);

export type DriverCashCollection = typeof driverCashCollectionsTable.$inferSelect;
export type InsertDriverCashCollection = typeof driverCashCollectionsTable.$inferInsert;
