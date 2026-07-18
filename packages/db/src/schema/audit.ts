import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const auditLogsTable = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_audit_logs_entity").on(table.entity, table.entityId),
    index("idx_audit_logs_actor_id").on(table.actorId),
  ]
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
