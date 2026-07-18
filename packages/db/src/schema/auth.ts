import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// One row per issued refresh token (hashed, never the raw token) — enables
// per-device session revocation (L11).
export const refreshTokensTable = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceInfo: text("device_info"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (table) => [index("idx_refresh_tokens_user_id").on(table.userId)]
);

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
export type InsertRefreshToken = typeof refreshTokensTable.$inferInsert;

export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const pushTokensTable = sqliteTable(
  "push_tokens",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform", { enum: DEVICE_PLATFORMS }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_push_tokens_user_id").on(table.userId),
    check("chk_push_tokens_platform", sql`${table.platform} in ('ios','android')`),
  ]
);

export type PushToken = typeof pushTokensTable.$inferSelect;
export type InsertPushToken = typeof pushTokensTable.$inferInsert;
