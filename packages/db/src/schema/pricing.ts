import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { citiesTable } from "./cities";
import { usersTable } from "./users";

// Admin-editable fare configuration (L8). cityId null = global default row.
export const pricingConfigTable = sqliteTable("pricing_config", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  cityId: text("city_id").references(() => citiesTable.id),
  baseFareCents: integer("base_fare_cents").notNull().default(250),
  perMileCents: integer("per_mile_cents").notNull().default(120),
  currency: text("currency").notNull().default("USD"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedBy: text("updated_by").references(() => usersTable.id),
});

export type PricingConfig = typeof pricingConfigTable.$inferSelect;
export type InsertPricingConfig = typeof pricingConfigTable.$inferInsert;
