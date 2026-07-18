import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { driverProfilesTable } from "./drivers";
import { usersTable } from "./users";

export const DRIVER_DOCUMENT_TYPES = ["license", "background_check", "photo"] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_DOCUMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type DriverDocumentStatus = (typeof DRIVER_DOCUMENT_STATUSES)[number];

// Sensitive driver documents (license / background check / photo), stored in
// R2 (r2Key only — never a public URL). Once APPROVED, the API must never
// expose a delete route for a row here (L17 — write-once for safety/compliance).
export const driverDocumentsTable = sqliteTable(
  "driver_documents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverId: text("driver_id")
      .notNull()
      .references(() => driverProfilesTable.id, { onDelete: "cascade" }),
    type: text("type", { enum: DRIVER_DOCUMENT_TYPES }).notNull(),
    r2Key: text("r2_key").notNull(),
    status: text("status", { enum: DRIVER_DOCUMENT_STATUSES }).notNull().default("PENDING"),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    reviewedBy: text("reviewed_by").references(() => usersTable.id),
  },
  (table) => [
    index("idx_driver_documents_driver_id").on(table.driverId),
    check("chk_driver_documents_type", sql`${table.type} in ('license','background_check','photo')`),
    check("chk_driver_documents_status", sql`${table.status} in ('PENDING','APPROVED','REJECTED')`),
  ]
);

export type DriverDocument = typeof driverDocumentsTable.$inferSelect;
export type InsertDriverDocument = typeof driverDocumentsTable.$inferInsert;
