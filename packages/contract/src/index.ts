// Shared zod schemas — the single source of truth the OpenAPI doc is
// generated from (apps/api), which in turn generates the TS (web/admin) and
// Dart (Flutter) API clients. Business-entity schemas (auth, trips, drivers,
// ...) are added alongside their routes starting Faz 1.
export * from "./schemas/common";
export * from "./schemas/auth";
