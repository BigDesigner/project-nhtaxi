import { describe, expect, it } from "vitest";
import { req } from "../test-utils/http";

/**
 * Every driver endpoint must reject an anonymous caller.
 *
 * This exists because auth used to be applied route by route
 * (`use("/profile", ...)`, `use("/earnings", ...)`, …), which meant a newly
 * added endpoint was **public until someone remembered to add a line**. That
 * is exactly what happened when the photo upload was added. The router now
 * guards `*` and exempts only sign-up, and this test fails if that inverts
 * again or if a new route slips outside the guard.
 *
 * Add a row here whenever a driver endpoint is added.
 */
const PROTECTED: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/api/driver/profile" },
  { method: "PUT", path: "/api/driver/profile" },
  { method: "POST", path: "/api/driver/photo" },
  { method: "GET", path: "/api/driver/documents" },
  { method: "POST", path: "/api/driver/documents/license" },
  { method: "GET", path: "/api/driver/earnings" },
  { method: "GET", path: "/api/driver/balance" },
  { method: "GET", path: "/api/driver/sessions" },
];

describe("driver routes are protected by default", () => {
  for (const { method, path } of PROTECTED) {
    it(`${method} ${path} rejects an anonymous caller`, async () => {
      const res = await req(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status).toBe(401);
    });
  }

  it("still lets a new driver sign up without a session", async () => {
    // The one carve-out. If this 401s, the exemption is broken and nobody can
    // register at all.
    const res = await req("/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(401);
  });
});
