import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside a real workerd instance (via the pool), with the same
// D1/R2/Durable Object bindings declared in wrangler.toml — not mocks.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            // Lets test/apply-migrations.ts seed the schema.
            TEST_MIGRATIONS: migrations,
            // JWT_SECRET is a secret (never in wrangler.toml [vars]) normally
            // supplied via `.dev.vars`, which is gitignored and doesn't
            // exist in CI — tests need their own deterministic value so
            // they don't depend on a developer's local dotfile existing.
            JWT_SECRET: "test-only-secret-do-not-use-in-production",
            // Must be a valid base64-encoded 256-bit key (AES-GCM import),
            // unlike JWT_SECRET which accepts any string as HMAC key material.
            DOCUMENT_ENCRYPTION_KEY: "AZSkIRAQ3dpCaeg6lN0SqcBwvcU6ry/fvOmVv7v0L4U=",
            ADMIN_BOOTSTRAP_TOKEN: "test-only-bootstrap-token",
            // Faz 6 — deliberately empty: lib/fcm.ts treats this as "not
            // configured" and no-ops rather than throwing, so tests can
            // exercise notification call sites without real Firebase creds.
            FCM_SERVICE_ACCOUNT_KEY: "",
          },
        },
      }),
    ],
    test: {
      // stub-routing must be listed: fares now come from a live routing
      // lookup, and without it every trip test would hit a public community
      // server — slow, flaky, and rude.
      setupFiles: ["./test/apply-migrations.ts", "./test/install-routing-stub.ts"],
    },
  };
});
