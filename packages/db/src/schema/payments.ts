import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tripsTable, PAYMENT_METHODS } from "./trips";

export const PAYMENT_STATUSES = ["PENDING", "COMPLETED", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentsTable = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: text("trip_id")
      .notNull()
      .references(() => tripsTable.id),
    // Money stored as integer cents (USD) — avoids float rounding drift in tax/reporting.
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    method: text("method", { enum: PAYMENT_METHODS }).notNull().default("cash"),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("PENDING"),
    // Stripe PaymentIntent / charge id once Faz 9 (payment module) lands.
    transactionId: text("transaction_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_payments_trip_id").on(table.tripId),
    check("chk_payments_method", sql`${table.method} in ('cash','card','online')`),
    check("chk_payments_status", sql`${table.status} in ('PENDING','COMPLETED','FAILED','REFUNDED')`),
  ]
);

export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
