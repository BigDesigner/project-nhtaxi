import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogsTable, createDb } from "@gnncab/db";
import { AuditAction, logAudit } from "./audit";

describe("audit log", () => {
  it("writes a row that can be read back", async () => {
    const db = createDb(env.DB);
    const entityId = crypto.randomUUID();

    await logAudit(db, {
      entity: "user",
      entityId,
      action: AuditAction.LOGIN_SUCCESS,
      actorId: entityId,
      actorRole: "customer",
      metadata: { via: "test" },
      ipAddress: "127.0.0.1",
    });

    const rows = await db.select().from(auditLogsTable).where(eq(auditLogsTable.entityId, entityId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe(AuditAction.LOGIN_SUCCESS);
    expect(rows[0]?.metadata).toEqual({ via: "test" });
  });
});
