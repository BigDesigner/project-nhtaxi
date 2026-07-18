import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const citiesTable = sqliteTable("cities", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  country: text("country").notNull().default("US"),
  state: text("state"),
  // Single-market deployment (North Conway, NH) — America/New_York default.
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lat: real("lat"),
  lng: real("lng"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type City = typeof citiesTable.$inferSelect;
export type InsertCity = typeof citiesTable.$inferInsert;
