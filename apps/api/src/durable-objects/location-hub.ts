import { DurableObject } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, driverProfilesTable, tripsTable } from "@gnncab/db";
import type { Env } from "../env";
import { verifyAccessToken } from "../lib/jwt";
import { getTokenFromUpgradeRequest } from "../lib/ws-auth";

const LOC_UPDATE_LIMIT = 30; // per LOC_UPDATE_WINDOW_MS, per connection (SRS §4.1)
const LOC_UPDATE_WINDOW_MS = 60_000;
const ACTIVE_TRIP_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_ACCEPTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

interface WsAttachment {
  userId: string;
  role: string;
  locCount: number;
  locWindowStart: number;
}

/**
 * Singleton (one instance for the whole system, `idFromName("global")") —
 * every driver/customer/admin WebSocket connects here. Drivers push
 * LOCATION_UPDATE; the hub persists it to D1 and fans it out to the
 * customer of that driver's active trip (if any) plus every connected
 * admin. Uses WebSocket Hibernation so idle connections don't hold the DO
 * in memory, and per-connection state (identity, rate-limit window) rides
 * along via serializeAttachment/deserializeAttachment, which survives
 * hibernation (a plain in-memory Map would not).
 */
export class LocationHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const token = getTokenFromUpgradeRequest(request);
    if (!token) return new Response("Unauthorized", { status: 401 });

    let payload;
    try {
      payload = await verifyAccessToken(token, this.env.JWT_SECRET);
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: payload.sub,
      role: payload.role,
      locCount: 0,
      locWindowStart: Date.now(),
    } satisfies WsAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof msg.type !== "string") return;

    if (msg.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }

    if (msg.type === "LOCATION_UPDATE") {
      await this.handleLocationUpdate(ws, msg);
    }
  }

  private async handleLocationUpdate(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (!attachment) return;

    if (attachment.role !== "driver") {
      ws.send(JSON.stringify({ type: "ERROR", message: "Only drivers can send location updates" }));
      return;
    }

    const { lat, lng } = msg;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      ws.send(JSON.stringify({ type: "ERROR", message: "Invalid coordinates" }));
      return;
    }

    const now = Date.now();
    if (now - attachment.locWindowStart > LOC_UPDATE_WINDOW_MS) {
      attachment.locCount = 0;
      attachment.locWindowStart = now;
    }
    if (attachment.locCount >= LOC_UPDATE_LIMIT) {
      ws.send(JSON.stringify({ type: "RATE_LIMITED", message: "Location update rate limit exceeded" }));
      return;
    }
    attachment.locCount += 1;
    ws.serializeAttachment(attachment);

    const db = createDb(this.env.DB);
    const [driver] = await db
      .update(driverProfilesTable)
      .set({ currentLat: lat, currentLng: lng, lastSeen: new Date(), updatedAt: new Date() })
      .where(eq(driverProfilesTable.userId, attachment.userId))
      .returning();
    if (!driver) return;

    let customerId: string | undefined;
    if (driver.status !== "AVAILABLE") {
      const [trip] = await db
        .select({ customerId: tripsTable.customerId })
        .from(tripsTable)
        .where(and(eq(tripsTable.driverId, driver.id), inArray(tripsTable.status, ACTIVE_TRIP_STATUSES)))
        .limit(1);
      customerId = trip?.customerId;
    }

    const payload = JSON.stringify({
      type: "DRIVER_LOCATION",
      driverId: driver.id,
      lat,
      lng,
      status: driver.status,
    });

    for (const socket of this.ctx.getWebSockets()) {
      const recipient = socket.deserializeAttachment() as WsAttachment | null;
      if (!recipient) continue;
      if (recipient.role === "admin" || (customerId && recipient.userId === customerId)) {
        socket.send(payload);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are reserved codes the runtime reports for abrupt
    // disconnects (tab close, backgrounding, network drop) — they describe
    // why the socket closed but throw if re-sent explicitly via ws.close().
    try {
      ws.close(code, reason);
    } catch {
      // socket is already closing; nothing left to do
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("[LocationHub] socket error", error);
  }
}
