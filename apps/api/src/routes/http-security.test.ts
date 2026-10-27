import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../app";

describe("HTTP request boundaries", () => {
  it("rejects an oversized declared JSON body before validation", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "65537" },
      body: "{}",
    }, env);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "PayloadTooLarge" });
  });

  it("also bounds streamed JSON without Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
        controller.enqueue(new Uint8Array(32 * 1024 + 1));
        controller.close();
      },
    });
    const res = await app.request("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }, env);
    expect(res.status).toBe(413);
  });

  it("preserves normal JSON validation after reading a stream", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }, env);
    expect(res.status).toBe(400);
  });

  it("keeps binary uploads above 64 KB behind driver authentication", async () => {
    const res = await app.request("/api/driver/photo", {
      method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(65537),
    }, env);
    expect(res.status).toBe(401);
  });

  it("adds security headers to successful and missing routes", async () => {
    for (const path of ["/api/healthz", "/api/no-such-route"]) {
      const res = await app.request(path, {}, env);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    }
  });
});
