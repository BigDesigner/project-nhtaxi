import type { DispatchCoordinator } from "./durable-objects/dispatch-coordinator";
import type { LocationHub } from "./durable-objects/location-hub";

export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  DISPATCH_COORDINATOR: DurableObjectNamespace<DispatchCoordinator>;
  LOCATION_HUB: DurableObjectNamespace<LocationHub>;
  JWT_SECRET: string;
  DOCUMENT_ENCRYPTION_KEY: string;
  ADMIN_BOOTSTRAP_TOKEN: string;
  // Faz 6 — Firebase service-account JSON (contents, not a file path) for
  // signing FCM HTTP v1 requests. Empty/unset is treated as "not configured
  // yet" (lib/fcm.ts no-ops) rather than throwing, since it's provisioned
  // late in this phase's rollout.
  FCM_SERVICE_ACCOUNT_KEY: string;
  /**
   * Brevo transactional-email API key (lib/email.ts). Same rollout pattern
   * as the FCM key above: empty/unset means "not configured yet" and every
   * send silently no-ops rather than throwing. Set in production with
   * `wrangler secret put BREVO_API_KEY` — never committed, never passed
   * through this codebase in plaintext.
   */
  BREVO_API_KEY: string;
  /**
   * Base URL of an OSRM-compatible routing service, used to price journeys
   * by real driving distance (lib/routing.ts). Optional: defaults to the
   * public OSRM instance, which is fine for this volume but is a demo
   * service — moving to a self-hosted or paid OSRM endpoint is a change to
   * this value alone, no code.
   */
  ROUTING_BASE_URL?: string;
  ENVIRONMENT: string;
};

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  isAdmin: boolean;
}

export type Variables = {
  user?: AuthUser;
};

export type AppBindings = { Bindings: Env; Variables: Variables };
