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
  ENVIRONMENT: string;
};

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

export type Variables = {
  user?: AuthUser;
};

export type AppBindings = { Bindings: Env; Variables: Variables };
