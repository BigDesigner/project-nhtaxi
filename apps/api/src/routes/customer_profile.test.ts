import { describe, expect, it } from "vitest";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

describe("customer profile", () => {
  it("returns the logged-in passenger's own profile", async () => {
    const email = uniqueEmail("passenger");
    const jar = new CookieJar();

    const registerRes = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Pat",
        lastName: "Passenger",
        email,
        phone: "+16035550001",
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
      }),
    });
    jar.applySetCookie(registerRes);

    const profileRes = await req("/api/customer/profile", { headers: { Cookie: jar.header() } });
    expect(profileRes.status).toBe(200);
    const profile = await readJson(profileRes);
    expect(profile.email).toBe(email);
    expect(profile.totalTrips).toBe(0);
    expect(profile.preferredPaymentMethod).toBeNull();
  });

  it("is forbidden for a driver", async () => {
    const jar = new CookieJar();
    const registerRes = await req("/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Dan",
        lastName: "Driver",
        email: uniqueEmail("driver"),
        phone: "+16035550002",
        password: "correct horse battery staple",
        acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
      }),
    });
    jar.applySetCookie(registerRes);

    const res = await req("/api/customer/profile", { headers: { Cookie: jar.header() } });
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await req("/api/customer/profile");
    expect(res.status).toBe(401);
  });
});
