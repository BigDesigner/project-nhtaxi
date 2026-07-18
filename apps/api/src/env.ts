import type { DispatchCoordinator } from "./durable-objects/dispatch-coordinator";

export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  DISPATCH_COORDINATOR: DurableObjectNamespace<DispatchCoordinator>;
  JWT_SECRET: string;
  ENVIRONMENT: string;
};

export type AppBindings = { Bindings: Env };
