import type { Context } from "hono";
import type { AppBindings } from "../env";

export function clientIp(c: Context<AppBindings>): string | undefined {
  return c.req.header("CF-Connecting-IP") ?? undefined;
}
