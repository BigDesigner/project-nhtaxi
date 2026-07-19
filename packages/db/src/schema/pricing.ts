import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { citiesTable } from "./cities";
import { usersTable } from "./users";

// Admin-editable fare configuration (L8). cityId null = global default row.
export const pricingConfigTable = sqliteTable("pricing_config", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  cityId: text("city_id").references(() => citiesTable.id),
  baseFareCents: integer("base_fare_cents").notNull().default(250),
  perMileCents: integer("per_mile_cents").notNull().default(120),
  // Faz 5b: GNN LLC's own revenue model — drivers pay per minute of active
  // (non-OFFLINE) app time, plus a commission on admin-assigned trips only.
  driverUsagePerMinuteCents: integer("driver_usage_per_minute_cents").notNull().default(25),
  driverCommissionPercent: real("driver_commission_percent").notNull().default(20),
  currency: text("currency").notNull().default("USD"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedBy: text("updated_by").references(() => usersTable.id),
});

export type PricingConfig = typeof pricingConfigTable.$inferSelect;
export type InsertPricingConfig = typeof pricingConfigTable.$inferInsert;
