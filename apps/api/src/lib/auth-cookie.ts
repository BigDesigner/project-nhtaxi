import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppBindings } from "../env";

export const ACCESS_COOKIE_NAME = "gnncab_session";
export const REFRESH_COOKIE_NAME = "gnncab_refresh";
// Deliberately readable by JS (not httpOnly) — the web admin reads this and
// echoes it back as X-CSRF-Token on unsafe requests (double-submit, see
// middlewares/csrf.ts).
export const CSRF_COOKIE_NAME = "gnncab_csrf";

// admin.nhtaxi.com and api.nhtaxi.com are different subdomains of the same
// registrable domain — Domain=.nhtaxi.com makes the cookie visible to both,
// and SameSite=Lax still applies (same-site is about the registrable
// domain, not the exact host) (L28).
const COOKIE_DOMAIN = ".nhtaxi.com";

function isProduction(c: Context<AppBindings>): boolean {
  return c.env.ENVIRONMENT !== "development";
}

function baseCookieOptions(c: Context<AppBindings>) {
  const production = isProduction(c);
  return {
    secure: production,
    sameSite: "Lax" as const,
    domain: production ? COOKIE_DOMAIN : undefined,
    path: "/",
  };
}

export function setAuthCookies(
  c: Context<AppBindings>,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date }
): void {
  const base = baseCookieOptions(c);

  setCookie(c, ACCESS_COOKIE_NAME, tokens.accessToken, { ...base, httpOnly: true });
  setCookie(c, REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    expires: tokens.refreshExpiresAt,
  });
  setCookie(c, CSRF_COOKIE_NAME, crypto.randomUUID(), {
    ...base,
    httpOnly: false,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(c: Context<AppBindings>): void {
  const base = baseCookieOptions(c);
  deleteCookie(c, ACCESS_COOKIE_NAME, base);
  deleteCookie(c, REFRESH_COOKIE_NAME, base);
  deleteCookie(c, CSRF_COOKIE_NAME, base);
}

export function getAccessTokenCookie(c: Context<AppBindings>): string | undefined {
  return getCookie(c, ACCESS_COOKIE_NAME);
}

export function getRefreshTokenCookie(c: Context<AppBindings>): string | undefined {
  return getCookie(c, REFRESH_COOKIE_NAME);
}
