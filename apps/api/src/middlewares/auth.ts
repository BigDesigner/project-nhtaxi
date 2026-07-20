import type { Context, Next } from "hono";
import type { AppBindings } from "../env";
import { getAccessTokenCookie } from "../lib/auth-cookie";
import { verifyAccessToken } from "../lib/jwt";

/**
 * Verifies the access token (Bearer header for mobile, cookie for web) and
 * attaches `c.get("user")`. Must run before `requireRole`.
 */
export async function authenticate(c: Context<AppBindings>, next: Next): Promise<Response | void> {
  const bearerHeader = c.req.header("Authorization");
  const bearerToken = bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : undefined;
  const token = bearerToken ?? getAccessTokenCookie(c);

  if (!token) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid authentication token" }, 401);
  }

  try {
    const payload = await verifyAccessToken(token, c.env.JWT_SECRET);
    c.set("user", { userId: payload.sub, email: payload.email, role: payload.role, isAdmin: payload.isAdmin });
  } catch {
    return c.json({ error: "Unauthorized", message: "Token is invalid or has expired" }, 401);
  }

  await next();
}

/**
 * Ensures the caller has one of the allowed roles. Must run after
 * `authenticate`.
 *
 * `isAdmin` is deliberately not consulted here: this checks `role` alone, so
 * a driver account with `isAdmin: true` (the owner-operator — see the schema
 * comment on `users.isAdmin`) is treated as an ordinary driver by every
 * driver-only route, exactly as if the flag didn't exist. `requireAdmin`
 * below is the one place that flag matters.
 */
export function requireRole(...roles: string[]) {
  return async (c: Context<AppBindings>, next: Next): Promise<Response | void> => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized", message: "Not authenticated" }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: "Forbidden", message: "You do not have permission to perform this action" }, 403);
    }
    await next();
  };
}

/**
 * Admin access, granted by either path: the traditional `role === "admin"`
 * account, or a driver account carrying `isAdmin: true` — the owner-operator
 * who also drives. Every admin-only route uses this instead of
 * `requireRole("admin")` so both paths reach the same gate.
 */
export function requireAdmin() {
  return async (c: Context<AppBindings>, next: Next): Promise<Response | void> => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized", message: "Not authenticated" }, 401);
    }
    if (user.role !== "admin" && !user.isAdmin) {
      return c.json({ error: "Forbidden", message: "You do not have permission to perform this action" }, 403);
    }
    await next();
  };
}
