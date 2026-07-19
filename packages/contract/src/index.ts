// Shared zod schemas — the single source of truth the OpenAPI doc is
// generated from (apps/api), which in turn generates the TS (web/admin) and
// Dart (Flutter) API clients. Business-entity schemas (auth, trips, drivers,
// ...) are added alongside their routes starting Faz 1.
export * from "./schemas/common";
export * from "./schemas/auth";
export * from "./schemas/driver";
export * from "./schemas/customer";
export * from "./schemas/cities";
export * from "./schemas/pricing";
export * from "./schemas/admin";
export * from "./schemas/trips";
export * from "./schemas/reports";
export * from "./schemas/driver-billing";
