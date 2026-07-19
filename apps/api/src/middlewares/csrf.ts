import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "../env";
import { ACCESS_COOKIE_NAME, CSRF_COOKIE_NAME } from "../lib/auth-cookie";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Double-submit CSRF check for cookie-authenticated requests only.
 *
 * - Bearer-token requests (mobile) never carry a cookie, so they're exempt.
 * - Requests with no existing session cookie are exempt too — there's no
 *   session yet to hijack, which is exactly what lets /auth/login and
 *   /auth/register (both unsafe-method POSTs) work without a chicken-and-egg
 *   CSRF token requirement.
 * - Everything else (an unsafe-method request from a browser that already
 *   has a session cookie) must echo the CSRF cookie value in X-CSRF-Token.
 */
export async function requireCsrfForCookieAuth(c: Context<AppBindings>, next: Next): Promise<Response | void> {
  const hasBearerAuth = c.req.header("Authorization")?.startsWith("Bearer ") ?? false;
  const hasSessionCookie = Boolean(getCookie(c, ACCESS_COOKIE_NAME));
  const needsCsrfCheck = !hasBearerAuth && hasSessionCookie && UNSAFE_METHODS.has(c.req.method);

  if (!needsCsrfCheck) {
    await next();
    return;
  }

  const csrfCookie = getCookie(c, CSRF_COOKIE_NAME);
  const csrfHeader = c.req.header("X-CSRF-Token");

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return c.json({ error: "Forbidden", message: "Missing or invalid CSRF token" }, 403);
  }

  await next();
}
