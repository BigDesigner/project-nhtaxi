import { createDb } from "@gnncab/db";
import app from "./app";
import type { Env } from "./env";
import { closeStaleSessions } from "./lib/driver-sessions";

export { DispatchCoordinator } from "./durable-objects/dispatch-coordinator";
export { LocationHub } from "./durable-objects/location-hub";

export default {
  fetch: app.fetch,
  // Faz 5b — periodic safety net closing abandoned driver sessions (app
  // crash, no connectivity) so a driver is never billed for an unverifiable
  // stale gap. See lib/driver-sessions.ts for the actual logic; this is a
  // thin wrapper so tests can call closeStaleSessions directly.
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await closeStaleSessions(createDb(env.DB), new Date());
  },
};
