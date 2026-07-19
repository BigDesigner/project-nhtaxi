import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../app";

describe("GET /api/healthz", () => {
  it("returns ok status", async () => {
    const res = await app.request("/api/healthz", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", environment: env.ENVIRONMENT });
  });
});
