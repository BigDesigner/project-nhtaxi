import { describe, expect, it } from "vitest";
import app from "../app";
import type { Env } from "../env";

const testEnv = { ENVIRONMENT: "test" } as Env;

describe("GET /api/healthz", () => {
  it("returns ok status", async () => {
    const res = await app.request("/api/healthz", {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", environment: "test" });
  });
});
