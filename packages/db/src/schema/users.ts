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
     * An extra permission bit, orthogonal to `role` — grants full admin
     * access regardless of what `role` says.
     *
     * This exists for exactly one situation: the owner-operator who both
     * runs the office *and* drives. `role` stays their real functional
     * identity (`'driver'`, in that case) so every existing driver-side check
     * in this codebase — dispatch, `driver_profiles`, the whole driver app —
     * needs zero changes to keep working for that account. `isAdmin` is what
     * additionally unlocks the admin panel on top of it.
     *
     * There is deliberately no API path that sets this to `true` (see the
     * `role === "admin"` guards in routes/admin.ts). It is flipped by direct
     * database access only — the same one-admin discipline `role`'s own
     * bootstrap-then-lock already enforces, extended to cover this column too.
     */
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
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
