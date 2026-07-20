import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readJson, req, uniqueEmail } from "../test-utils/http";

// D1 storage is isolated per *file* (not per `it()`), so these run as a
// deliberate sequence in one file: nobody has bootstrapped yet → someone
// does → the endpoint is now permanently inert. Splitting this across
// files would risk another file's admin.test.ts (which creates admins
// directly via DB) making the "zero admins" precondition here flaky.
describe("admin bootstrap (sequential)", () => {
  it("rejects a missing/wrong bootstrap token", async () => {
    const res = await req("/api/admin/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Ada",
        lastName: "Admin",
        email: uniqueEmail("bootstrap"),
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("creates the first admin when no admin exists yet, and logs them in", async () => {
    const email = uniqueEmail("bootstrap");
    const res = await req("/api/admin/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bootstrap-Token": env.ADMIN_BOOTSTRAP_TOKEN },
      body: JSON.stringify({ firstName: "Ada", lastName: "Admin", email, acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple" }),
    });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.user.role).toBe("admin");
    expect(body.user.email).toBe(email);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("is permanently inert once an admin exists — even with the right token", async () => {
    const res = await req("/api/admin/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bootstrap-Token": env.ADMIN_BOOTSTRAP_TOKEN },
      body: JSON.stringify({
        firstName: "Second",
        lastName: "Admin",
        email: uniqueEmail("bootstrap"),
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
      }),
    });
    expect(res.status).toBe(409);
  });
});
