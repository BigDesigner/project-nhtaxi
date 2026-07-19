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
