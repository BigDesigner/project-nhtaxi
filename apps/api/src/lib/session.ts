import type { Context } from "hono";
import type { Database } from "@gnncab/db";
import type { AppBindings } from "../env";
import { setAuthCookies } from "./auth-cookie";
import { signAccessToken } from "./jwt";
import { issueRefreshToken } from "./refresh-tokens";

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: "admin" | "driver" | "customer";
}

export function toPublicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role as PublicUser["role"],
  };
}

/**
 * Issues an access+refresh pair and shapes the response — shared by
 * /auth/register, /auth/login, and driver self sign-up (routes/driver_profile.ts).
 * Cookies are only set for "web" (mobile uses Bearer tokens exclusively and
 * never carries cookies — see contract/schemas/auth.ts), and tokens are only
 * echoed in the body for non-web platforms (a web response reflecting its
 * own httpOnly cookie value back in the body would let an XSS payload read
 * it via fetch(), defeating httpOnly entirely).
 */
export async function issueSession(
  c: Context<AppBindings>,
  db: Database,
  user: PublicUser,
  platform: "web" | "ios" | "android",
  deviceInfo?: string
) {
  const accessToken = await signAccessToken({ id: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET);
  const { rawToken: refreshToken, expiresAt } = await issueRefreshToken(db, user.id, deviceInfo);
  if (platform === "web") {
    setAuthCookies(c, { accessToken, refreshToken, refreshExpiresAt: expiresAt });
  }

  return {
    user,
    accessToken: platform === "web" ? null : accessToken,
    refreshToken: platform === "web" ? null : refreshToken,
  };
}
