import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
  ErrorResponseSchema,
  PushTokenAckSchema,
  RegisterPushTokenRequestSchema,
  UnregisterPushTokenRequestSchema,
} from "@gnncab/contract";
import { createDb, pushTokensTable } from "@gnncab/db";
import type { AppBindings } from "../env";
import { authenticate } from "../middlewares/auth";

// Faz 6 — any authenticated role (driver/customer/admin) can register a
// device for push. Notification targeting is by userId, not role.
const pushTokens = new OpenAPIHono<AppBindings>();
pushTokens.use("*", authenticate);

// ─── POST / — register (or re-register) a device's FCM token ─────────────
const registerRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["push-tokens"],
  summary: "Register (or update ownership of) a device's FCM token",
  request: { body: { required: true, content: { "application/json": { schema: RegisterPushTokenRequestSchema } } } },
  responses: {
    200: { description: "Registered", content: { "application/json": { schema: PushTokenAckSchema } } },
  },
});

pushTokens.openapi(registerRoute, async (c) => {
  const authUser = c.get("user")!;
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [existing] = await db
    .select({ id: pushTokensTable.id })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.token, body.token))
    .limit(1);

  if (existing) {
    // Same device token re-registering — possibly under a different logged-in
    // user (e.g. shared/handed-off device), so ownership is updated too.
    await db
      .update(pushTokensTable)
      .set({ userId: authUser.userId, platform: body.platform, updatedAt: new Date() })
      .where(eq(pushTokensTable.id, existing.id));
  } else {
    await db.insert(pushTokensTable).values({ userId: authUser.userId, token: body.token, platform: body.platform });
  }

  return c.json({ status: "ok" as const }, 200);
});

// ─── DELETE / — unregister a device (e.g. on logout) ──────────────────────
const unregisterRoute = createRoute({
  method: "delete",
  path: "/",
  tags: ["push-tokens"],
  summary: "Unregister a device's FCM token (e.g. on logout)",
  request: { body: { required: true, content: { "application/json": { schema: UnregisterPushTokenRequestSchema } } } },
  responses: {
    200: { description: "Unregistered", content: { "application/json": { schema: PushTokenAckSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

pushTokens.openapi(unregisterRoute, async (c) => {
  const authUser = c.get("user")!;
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [existing] = await db
    .select({ id: pushTokensTable.id, userId: pushTokensTable.userId })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.token, body.token))
    .limit(1);
  if (!existing || existing.userId !== authUser.userId) {
    return c.json({ error: "NotFound", message: "No such token registered to you" }, 404);
  }

  await db.delete(pushTokensTable).where(eq(pushTokensTable.id, existing.id));
  return c.json({ status: "ok" as const }, 200);
});

export default pushTokens;
