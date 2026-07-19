import { ACCESS_COOKIE_NAME } from "./auth-cookie";

/** Web (browser) WebSocket clients send cookies automatically on the
 * upgrade request — mobile has none, so it sends the access token as a
 * `Sec-WebSocket-Protocol: auth.<token>` subprotocol instead (same scheme
 * as the original project). */
export function getTokenFromUpgradeRequest(request: Request): string | null {
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  if (protocolHeader) {
    for (const entry of protocolHeader.split(",").map((p) => p.trim())) {
      if (entry.startsWith("auth.") && entry.length > 5) return entry.slice(5);
    }
  }

  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    for (const entry of cookieHeader.split(";").map((p) => p.trim())) {
      if (entry.startsWith(`${ACCESS_COOKIE_NAME}=`)) {
        return decodeURIComponent(entry.slice(ACCESS_COOKIE_NAME.length + 1));
      }
    }
  }

  return null;
}
