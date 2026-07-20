import { sqliteTable, text, integer, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const USER_ROLES = ["admin", "driver", "customer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const usersTable = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    role: text("role", { enum: USER_ROLES }).notNull().default("customer"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /**
     * When this person accepted the terms, and which version they saw.
     *
     * Recording the version matters as much as the timestamp: "they agreed"
     * is worth little in a dispute if we can't say what they agreed *to*.
     * Both are null for the accounts that pre-date the in-app agreement.
     */
    termsAcceptedAt: integer("terms_accepted_at", { mode: "timestamp" }),
    termsVersion: text("terms_version"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  // SQLite has no native enum type — the CHECK is the DB-level enforcement
  // backing the TS union (defense in depth alongside app-layer zod validation).
  (table) => [check("chk_users_role", sql`${table.role} in ('admin','driver','customer')`)]
);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
