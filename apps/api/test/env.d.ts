import type { Env as ApiEnv } from "../src/env";

// Lets test files do `import { env } from "cloudflare:workers"` and get the
// real binding types, plus the test-only migrations binding wired in
// vitest.config.ts. The binding list itself lives in src/env.ts — not
// duplicated here (aliased on import to avoid shadowing `Cloudflare.Env`
// itself). `declare global` is required because the `import` above makes
// this a module, not an ambient script.
declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
