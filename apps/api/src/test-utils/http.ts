import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import app from "../app";
import { CSRF_COOKIE_NAME } from "../lib/auth-cookie";

/**
 * Route handlers use `c.executionCtx.waitUntil()` for non-blocking audit
 * writes — that getter throws unless a real ExecutionContext is supplied,
 * which `app.request(path, init, env)` (3-arg form) doesn't provide. This
 * wraps every call with one from `cloudflare:test` and waits for its
 * waitUntil'ed promises before returning, so audit writes are done by the
 * time a test's assertions run.
 */
export async function req(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// Response.json() types as `unknown` here — tests intentionally poke at
// loosely-typed response bodies, so read them through `any`.
export async function readJson(res: Response): Promise<any> {
  return res.json();
}

export function uniqueEmail(prefix = "test"): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/** Minimal cookie jar so tests can act like a real browser across requests. */
export class CookieJar {
  private cookies = new Map<string, string>();

  applySetCookie(res: Response): void {
    for (const header of res.headers.getSetCookie()) {
      const first = header.split(";")[0] ?? "";
      const eqIdx = first.indexOf("=");
      if (eqIdx === -1) continue;
      this.cookies.set(first.slice(0, eqIdx), first.slice(eqIdx + 1));
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /**
   * Headers for an unsafe-method (POST/PUT/DELETE) request on an existing
   * cookie session: Cookie + the matching X-CSRF-Token. Cookie-authenticated
   * unsafe requests get a blanket 403 from requireCsrfForCookieAuth without
   * this (see middlewares/csrf.ts) — easy to forget, so it's one call here
   * instead of copy-pasted at every call site.
   */
  csrfHeaders(extra?: Record<string, string>): Record<string, string> {
    return { ...extra, Cookie: this.header(), "X-CSRF-Token": this.get(CSRF_COOKIE_NAME) ?? "" };
  }
}
