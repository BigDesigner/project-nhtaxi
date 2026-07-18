import { defineConfig } from "drizzle-kit";

// Generates plain SQL migration files (no live DB connection needed here).
// Applying them to D1 is a separate step: `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: "sqlite",
  schema: "../../packages/db/src/schema/index.ts",
  out: "./migrations",
});
