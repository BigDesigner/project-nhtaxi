import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createDb, tripsTable } from "@gnncab/db";
import type { Env } from "../env";
import {
  assignTripToDriver,
  claimDriver,
  clearSearchSchedule,
  DISPATCH_TIMEOUT_MS,
  findNearestAvailableDriver,
  findPreferredDriver,
  freeDriver,
  markDriverNoResponse,
  markTripTimeout,
  MAX_DISPATCH_ATTEMPTS,
  MAX_SEARCH_ROUNDS,
  scheduleNextSearch,
  SEARCH_RETRY_INTERVAL_MS,
} from "../lib/dispatch";
import { sendPushToDriver, sendPushToUser } from "../lib/fcm";
import { customerTripNotification, NEW_TRIP_ASSIGNED_NOTIFICATION } from "../lib/trip-notifications";

/** Once a trip reaches any of these, searching for a driver is pointless. */
const SEARCH_ENDED_STATUSES = new Set<string>([
  "DRIVER_ACCEPTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
  "TRIP_CANCELLED",
  "TIMEOUT",
]);

interface DispatchState {
  tripId: string;
  /** Drivers already tried *within the current sweep*; reset each new sweep. */
  triedDriverIds: string[];
  /** How many sweeps for a driver we've made (1-based once searching). */
  searchRound: number;
  /**
   * The driver the passenger picked off the map, if any. Consumed once: we
   * offer them the trip first, and the moment they decline or go quiet this
   * is cleared so the ordinary nearest-driver search takes over. Without the
   * clearing step they'd be re-offered every sweep (triedDriverIds resets),
   * and a passenger who picked someone now unreachable would never get a car.
   */
  preferredDriverId?: string;
  /**
   * What the pending Alarm means. Without this the single Alarm slot is
   * ambiguous — "the assigned driver went quiet" and "time to sweep again"
   * need completely different handling.
   */
  phase: "awaiting-driver" | "searching";
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

    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, state.tripId)).limit(1);
    if (!trip) return;
    // Somebody took the trip out of our hands — a driver accepted it, the
    // passenger cancelled, or an admin stepped in. Stop looking. (Statuses
    // that still need a driver — REQUESTED / DRIVER_ASSIGNED / _REJECTED /
    // _NO_RESPONSE — fall through and keep searching.)
    if (SEARCH_ENDED_STATUSES.has(trip.status)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // Everyone nearby has already turned this sweep down.
    if (state.triedDriverIds.length >= MAX_DISPATCH_ATTEMPTS) {
      await this.scheduleRetryOrGiveUp(state, "Everyone nearby declined");
      return;
    }

    // The passenger's pick gets the first offer; everything after is the
    // ordinary nearest-first search. Clearing it here (not after a successful
    // claim) means one shot either way — including when they're already gone,
    // which is exactly when falling back matters most.
    let candidate: { driverId: string; distanceMiles: number } | null = null;
    if (state.preferredDriverId) {
      candidate = await findPreferredDriver(db, state.preferredDriverId, trip.pickupLat, trip.pickupLng);
      state.preferredDriverId = undefined;
      await this.ctx.storage.put("dispatch", state);
    }
    candidate ??= await findNearestAvailableDriver(db, trip.pickupLat, trip.pickupLng, state.triedDriverIds);

    if (!candidate) {
      await this.scheduleRetryOrGiveUp(state, "No available drivers in range");
      return;
    }

    const claimed = await claimDriver(db, candidate.driverId);
    if (!claimed) {
      // Lost the race to another dispatch attempt — exclude it and retry.
      state.triedDriverIds.push(candidate.driverId);
      await this.ctx.storage.put("dispatch", state);
      await this.tryAssignNext();
      return;
    }

    state.triedDriverIds.push(candidate.driverId);
    state.phase = "awaiting-driver";
    await this.ctx.storage.put("dispatch", state);
    await clearSearchSchedule(db, state.tripId);
    await assignTripToDriver(db, state.tripId, candidate.driverId, candidate.distanceMiles);
    await this.ctx.storage.setAlarm(Date.now() + DISPATCH_TIMEOUT_MS);

    // Best-effort push, off the critical path (never throws either way, but
    // waitUntil also keeps the extra OAuth2+FCM round trip from delaying the
    // customer's trip-creation response, which awaits this DO's /dispatch call).
    this.ctx.waitUntil(sendPushToDriver(db, this.env.FCM_SERVICE_ACCOUNT_KEY, candidate.driverId, NEW_TRIP_ASSIGNED_NOTIFICATION));
    if (trip.customerId) {
      const notification = customerTripNotification("DRIVER_ASSIGNED");
      if (notification) this.ctx.waitUntil(sendPushToUser(db, this.env.FCM_SERVICE_ACCOUNT_KEY, trip.customerId, notification));
    }
  }

  /**
   * A sweep came up empty. Either wait a minute and look again, or — once
   * we've used up the budget — park the trip as TIMEOUT so a passenger who
   * has long since walked away isn't searched for indefinitely. They can
   * restart the search from the app (POST /api/trips/{id}/retry).
   */
  private async scheduleRetryOrGiveUp(state: DispatchState, reason: string): Promise<void> {
    const db = createDb(this.env.DB);

    // searchRound is the sweep we just finished, so this is the count of
    // *completed* sweeps — which is what the passenger sees as "attempt N of 15".
    const completedSweeps = state.searchRound;

    if (completedSweeps >= MAX_SEARCH_ROUNDS) {
      await this.ctx.storage.deleteAlarm();
      await clearSearchSchedule(db, state.tripId);
      await markTripTimeout(db, state.tripId, `${reason} after ${completedSweeps} attempts`);
      return;
    }

    const nextSearchAt = new Date(Date.now() + SEARCH_RETRY_INTERVAL_MS);
    state.searchRound = completedSweeps + 1;
    state.triedDriverIds = []; // a driver who declined may be free next sweep
    state.phase = "searching";
    await this.ctx.storage.put("dispatch", state);
    await scheduleNextSearch(db, state.tripId, completedSweeps, nextSearchAt);
    await this.ctx.storage.setAlarm(nextSearchAt.getTime());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/dispatch") {
      const { tripId, preferredDriverId } = (await request.json()) as {
        tripId: string;
        preferredDriverId?: string;
      };
      await this.ctx.storage.put<DispatchState>("dispatch", {
        tripId,
        triedDriverIds: [],
        searchRound: 1,
        phase: "searching",
        preferredDriverId,
      });
      await this.tryAssignNext();
      return new Response("ok");
    }

    // The passenger asked us to start looking again after we'd given up.
    if (request.method === "POST" && url.pathname === "/restart") {
      const { tripId } = (await request.json()) as { tripId: string };
      await this.ctx.storage.put<DispatchState>("dispatch", {
        tripId,
        triedDriverIds: [],
        searchRound: 1,
        phase: "searching",
      });
      await this.tryAssignNext();
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/cancelled") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete("dispatch");
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

    // Time for the next sweep — nobody is holding this trip.
    if (state.phase === "searching") {
      await this.tryAssignNext();
      return;
    }

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
