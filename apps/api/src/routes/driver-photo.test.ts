import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

/** A one-pixel PNG — real bytes, so the content-type check has something honest to pass. */
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

async function registerDriver(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550400",
      password: "correct horse battery staple",
      acceptedAgreement: true,
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [profile] = await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: 44.05, currentLng: -71.12 })
    .where(eq(driverProfilesTable.userId, user!.id))
    .returning({ id: driverProfilesTable.id });

  return { jar, driverId: profile!.id };
}

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550401",
      password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

describe("driver profile photo", () => {
  it("accepts an image and exposes it to passengers", async () => {
    const { jar, driverId } = await registerDriver(uniqueEmail("photo-ok"));

    const upload = await req("/api/driver/photo", {
      method: "POST",
      headers: { "Content-Type": "image/png", ...jar.csrfHeaders() },
      body: PNG_BYTES,
    });
    expect(upload.status).toBe(200);

    const passengerJar = await registerPassenger(uniqueEmail("photo-viewer"));
    const photo = await req(`/api/drivers/${driverId}/photo`, { headers: { Cookie: passengerJar.header() } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG_BYTES);

    // And the directory now points at it, so the app knows to fetch it.
    const { drivers } = await readJson(
      await req("/api/drivers", { headers: { Cookie: passengerJar.header() } })
    );
    const mine = drivers.find((d: { driverId: string }) => d.driverId === driverId);
    expect(mine.photoUrl).toBe(`/api/drivers/${driverId}/photo`);
  });

  it("refuses a file type that isn't a photograph", async () => {
    const { jar } = await registerDriver(uniqueEmail("photo-svg"));

    // SVG can carry script and this file is served back to browsers, so it is
    // rejected outright rather than sanitised.
    const res = await req("/api/driver/photo", {
      method: "POST",
      headers: { "Content-Type": "image/svg+xml", ...jar.csrfHeaders() },
      body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).message).toMatch(/JPEG, PNG or WebP/i);
  });

  it("refuses an empty upload", async () => {
    const { jar } = await registerDriver(uniqueEmail("photo-empty"));

    const res = await req("/api/driver/photo", {
      method: "POST",
      headers: { "Content-Type": "image/png", ...jar.csrfHeaders() },
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
  });

  it("404s for a driver who has not uploaded one", async () => {
    const { driverId } = await registerDriver(uniqueEmail("photo-none"));
    const passengerJar = await registerPassenger(uniqueEmail("photo-none-viewer"));

    const res = await req(`/api/drivers/${driverId}/photo`, { headers: { Cookie: passengerJar.header() } });
    expect(res.status).toBe(404);
  });

  it("will not serve anything outside the avatars prefix", async () => {
    // The load-bearing test: this route reads the same R2 bucket as the
    // envelope-encrypted identity documents. If photoKey is ever pointed at
    // one of those — by a bug or by hand — the route must refuse rather than
    // hand a passenger someone's licence.
    const { driverId } = await registerDriver(uniqueEmail("photo-escape"));
    const db = createDb(env.DB);

    await env.DOCS.put(`driver-documents/${driverId}/secret`, "encrypted licence bytes");
    await db
      .update(driverProfilesTable)
      .set({ photoKey: `driver-documents/${driverId}/secret` })
      .where(eq(driverProfilesTable.id, driverId));

    const passengerJar = await registerPassenger(uniqueEmail("photo-escape-viewer"));
    const res = await req(`/api/drivers/${driverId}/photo`, { headers: { Cookie: passengerJar.header() } });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated viewer", async () => {
    const { driverId } = await registerDriver(uniqueEmail("photo-anon"));
    expect((await req(`/api/drivers/${driverId}/photo`)).status).toBe(401);
  });
});
