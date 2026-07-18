import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/**
 * One DispatchCoordinator instance exists per active trip. It holds the
 * driver-acceptance timer (Alarm) and the WebSocket connections watching
 * that trip's live status — the durable, restart-safe replacement for the
 * old in-memory setTimeout dispatch queue (see .spec/rebuild_plan.md §7).
 *
 * This is the Faz 0 scaffold: hibernatable WebSocket accept/route + an
 * alarm stub. Full dispatch/redispatch/location-fanout logic lands in Faz 3-4.
 */
export class DispatchCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable accept: the DO can be evicted from memory between
    // messages/alarms without dropping the socket — Cloudflare resumes it.
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    // Faz 3/4: route LOCATION_UPDATE / driver accept-reject messages here.
    ws.send(JSON.stringify({ type: "ECHO", received: message }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async alarm(): Promise<void> {
    // Faz 3: 60s driver-acceptance timeout → mark DRIVER_NO_RESPONSE, tryRedispatch.
  }
}
