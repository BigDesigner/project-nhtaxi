import type { DispatchCoordinator } from "./durable-objects/dispatch-coordinator";

export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  DISPATCH_COORDINATOR: DurableObjectNamespace<DispatchCoordinator>;
  JWT_SECRET: string;
  DOCUMENT_ENCRYPTION_KEY: string;
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
