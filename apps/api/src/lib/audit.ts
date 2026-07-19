import { auditLogsTable, type Database } from "@gnncab/db";

export const AuditAction = {
  REGISTER: "REGISTER",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",
  TOKEN_REFRESH_REJECTED: "TOKEN_REFRESH_REJECTED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_APPROVED: "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  DOCUMENT_VIEWED: "DOCUMENT_VIEWED",
  DRIVER_VERIFIED: "DRIVER_VERIFIED",
  DRIVER_UNVERIFIED: "DRIVER_UNVERIFIED",
  USER_CREATED_BY_ADMIN: "USER_CREATED_BY_ADMIN",
  USER_UPDATED_BY_ADMIN: "USER_UPDATED_BY_ADMIN",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  PRICING_UPDATED: "PRICING_UPDATED",
  CITY_CREATED: "CITY_CREATED",
  TRIP_REQUESTED: "TRIP_REQUESTED",
  TRIP_DRIVER_ASSIGNED: "TRIP_DRIVER_ASSIGNED",
  TRIP_NO_DRIVER_AVAILABLE: "TRIP_NO_DRIVER_AVAILABLE",
  TRIP_STATUS_CHANGED: "TRIP_STATUS_CHANGED",
  TRIP_CANCELLED: "TRIP_CANCELLED",
} as const;

export interface LogAuditInput {
  entity: string;
  entityId?: string | null;
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Callers in request handlers should fire this via
 * `c.executionCtx.waitUntil(logAudit(...))` so the write completes without
 * delaying the response (Workers keeps the invocation alive for waitUntil
 * promises even after the response is sent).
 */
export async function logAudit(db: Database, input: LogAuditInput): Promise<void> {
  await db.insert(auditLogsTable).values({
    entity: input.entity,
    entityId: input.entityId ?? null,
    action: input.action,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    metadata: input.metadata,
    ipAddress: input.ipAddress ?? null,
  });
}
