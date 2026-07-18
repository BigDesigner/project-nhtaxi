import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { citiesTable } from "./cities";

export const zonesTable = sqliteTable("zones", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  cityId: text("city_id")
    .notNull()
    .references(() => citiesTable.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  polygon: text("polygon", { mode: "json" })
    .notNull()
    .$type<Array<{ lat: number; lng: number }>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type Zone = typeof zonesTable.$inferSelect;
export type InsertZone = typeof zonesTable.$inferInsert;
