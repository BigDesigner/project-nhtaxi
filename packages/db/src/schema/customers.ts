import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const customerProfilesTable = sqliteTable("customer_profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  preferredPaymentMethod: text("preferred_payment_method"),
  totalTrips: integer("total_trips").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type CustomerProfile = typeof customerProfilesTable.$inferSelect;
export type InsertCustomerProfile = typeof customerProfilesTable.$inferInsert;
