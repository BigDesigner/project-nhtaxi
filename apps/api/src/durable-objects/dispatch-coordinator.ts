import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createDb, tripsTable } from "@gnncab/db";
import type { Env } from "../env";
import {
  assignTripToDriver,
  claimDriver,
  DISPATCH_TIMEOUT_MS,
  findNearestAvailableDriver,
  freeDriver,
  markDriverNoResponse,
  markTripTimeout,
  MAX_DISPATCH_ATTEMPTS,
} from "../lib/dispatch";

interface DispatchState {
  tripId: string;
  triedDriverIds: string[];
}

/**
 * One DispatchCoordinator instance per active trip (keyed by tripId via
 * `idFromName`). It owns the 60-second driver-acceptance Alarm and the
 * redispatch loop — the durable, restart-safe replacement for the old
 * in-memory setTimeout dispatch queue (see .spec/rebuild_plan.md §7).
 *
 * Faz 3a's inline "assign once, TIMEOUT if nobody's around" logic in
 * routes/trips.ts is replaced by calls into this DO: POST /dispatch (first
 * attempt), POST /accepted (cancels the timer), POST /rejected (frees the
 * driver's DO-side state and immediately tries the next candidate).
 *
 * WebSocket location-fanout (Faz 4) is a separate concern and isn't wired
 * into this class yet.
 */
export class DispatchCoordinator extends DurableObject<Env> {
  private async tryAssignNext(): Promise<void> {
    const db = createDb(this.env.DB);
    const state = await this.ctx.storage.get<DispatchState>("dispatch");
    if (!state) return;

    if (state.triedDriverIds.length >= MAX_DISPATCH_ATTEMPTS) {
      await markTripTimeout(db, state.tripId, "Max dispatch attempts reached");
      return;
    }

    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, state.tripId)).limit(1);
    if (!trip) return;

    const nearest = await findNearestAvailableDriver(db, trip.pickupLat, trip.pickupLng, state.triedDriverIds);
    if (!nearest) {
      await markTripTimeout(db, state.tripId, "No available drivers in range");
      return;
    }

    const claimed = await claimDriver(db, nearest.driverId);
    if (!claimed) {
      // Lost the race to another dispatch attempt — exclude it and retry.
      state.triedDriverIds.push(nearest.driverId);
      await this.ctx.storage.put("dispatch", state);
      await this.tryAssignNext();
      return;
    }

    state.triedDriverIds.push(nearest.driverId);
    await this.ctx.storage.put("dispatch", state);
    await assignTripToDriver(db, state.tripId, nearest.driverId, nearest.distanceMiles);
    await this.ctx.storage.setAlarm(Date.now() + DISPATCH_TIMEOUT_MS);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/dispatch") {
      const { tripId } = (await request.json()) as { tripId: string };
      await this.ctx.storage.put<DispatchState>("dispatch", { tripId, triedDriverIds: [] });
      await this.tryAssignNext();
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/accepted") {
      await this.ctx.storage.deleteAlarm();
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/rejected") {
      await this.ctx.storage.deleteAlarm();
      await this.tryAssignNext();
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const db = createDb(this.env.DB);
    const state = await this.ctx.storage.get<DispatchState>("dispatch");
    if (!state) return;

    const lastDriverId = state.triedDriverIds[state.triedDriverIds.length - 1];
    if (!lastDriverId) return;

    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, state.tripId)).limit(1);
    // Driver already responded (accepted/rejected) in the meantime — nothing to do.
    if (!trip || trip.status !== "DRIVER_ASSIGNED" || trip.driverId !== lastDriverId) return;

    await freeDriver(db, lastDriverId);
    await markDriverNoResponse(db, state.tripId, lastDriverId);
    await this.tryAssignNext();
  }
}
