import { sign, verify } from "hono/jwt";

// Short-lived access token (L11 — 15 min). Long-lived sessions are carried
// by the refresh token (see refresh-tokens.ts), never by this token.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  // Orthogonal to role — see the schema comment on users.isAdmin for why
  // this exists instead of just adding "admin" to role's own possibilities.
  isAdmin: boolean;
  exp: number;
}

export async function signAccessToken(
  user: { id: string; email: string; role: string; isAdmin: boolean },
  secret: string
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  return sign({ sub: user.id, email: user.email, role: user.role, isAdmin: user.isAdmin, exp }, secret);
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenPayload> {
  const payload = await verify(token, secret, "HS256");
  return payload as unknown as AccessTokenPayload;
}
