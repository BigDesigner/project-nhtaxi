import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { ACCESS_COOKIE_NAME } from "../lib/auth-cookie";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

async function registerDriver(email: string, lat: number, lng: number) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550040",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: lat, currentLng: lng })
    .where(eq(driverProfilesTable.userId, user!.id));

  const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return { jar, driverProfileId: dp!.id };
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
      phone: "+16035550041",
      acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

async function registerAdmin(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/admin/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bootstrap-Token": env.ADMIN_BOOTSTRAP_TOKEN },
    body: JSON.stringify({ firstName: "Ada", lastName: "Admin", email, acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple" }),
  });
  jar.applySetCookie(res);
  return jar;
}

async function createTrip(passengerJar: CookieJar, pickup: object, dropoff: object) {
  const res = await req("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
    body: JSON.stringify({ ...pickup, ...dropoff, paymentMethod: "cash" }),
  });
  return readJson(res);
}

function stub() {
  const id = env.LOCATION_HUB.idFromName("global");
  return env.LOCATION_HUB.get(id);
}

async function connectViaCookie(cookie: string): Promise<WebSocket> {
  const res = await stub().fetch("http://location-hub/", { headers: { Upgrade: "websocket", Cookie: cookie } });
  if (!res.webSocket) throw new Error(`expected a websocket upgrade, got status ${res.status}`);
  res.webSocket.accept();
  return res.webSocket;
}

async function connectViaProtocol(token: string): Promise<WebSocket> {
  const res = await stub().fetch("http://location-hub/", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `auth.${token}` },
  });
  if (!res.webSocket) throw new Error(`expected a websocket upgrade, got status ${res.status}`);
  res.webSocket.accept();
  return res.webSocket;
}

function onceMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (evt) => resolve(JSON.parse(evt.data as string)), { once: true });
  });
}

function expectMessage(ws: WebSocket): Promise<any> {
  return Promise.race([
    onceMessage(ws),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for ws message")), 2000)),
  ]);
}

async function expectNoMessage(ws: WebSocket, ms = 300): Promise<void> {
  const sentinel = Symbol("no-message");
  const result = await Promise.race([onceMessage(ws), new Promise((resolve) => setTimeout(() => resolve(sentinel), ms))]);
  expect(result).toBe(sentinel);
}

describe("LocationHub — live tracking WebSocket", () => {
  it("rejects a WebSocket upgrade without a valid token", async () => {
    const res = await stub().fetch("http://location-hub/", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("broadcasts a driver's location to their active trip's customer and every admin, but not to unrelated connections", async () => {
    const pickup = { pickupLat: 44.0, pickupLng: -71.1273, pickupAddress: "Main St" };
    const dropoff = { dropoffLat: 44.03, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" };
    const driver = await registerDriver(uniqueEmail("loc-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("loc-passenger"));
    const bystanderJar = await registerPassenger(uniqueEmail("loc-bystander"));
    const adminJar = await registerAdmin(uniqueEmail("loc-admin"));

    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.driverId).toBe(driver.driverProfileId);

    const driverWs = await connectViaCookie(driver.jar.header());
    const passengerWs = await connectViaCookie(passengerJar.header());
    const bystanderWs = await connectViaCookie(bystanderJar.header());
    const adminWs = await connectViaProtocol(adminJar.get(ACCESS_COOKIE_NAME)!);

    const newLat = pickup.pickupLat + 0.001;
    const newLng = pickup.pickupLng + 0.001;

    try {
      driverWs.send(JSON.stringify({ type: "LOCATION_UPDATE", lat: newLat, lng: newLng }));

      const [toPassenger, toAdmin] = await Promise.all([expectMessage(passengerWs), expectMessage(adminWs)]);
      for (const msg of [toPassenger, toAdmin]) {
        expect(msg.type).toBe("DRIVER_LOCATION");
        expect(msg.driverId).toBe(driver.driverProfileId);
        expect(msg.lat).toBeCloseTo(newLat);
        expect(msg.lng).toBeCloseTo(newLng);
      }

      await expectNoMessage(bystanderWs);

      const db = createDb(env.DB);
      const [dp] = await db
        .select()
        .from(driverProfilesTable)
        .where(eq(driverProfilesTable.id, driver.driverProfileId))
        .limit(1);
      expect(dp!.currentLat).toBeCloseTo(newLat);
      expect(dp!.currentLng).toBeCloseTo(newLng);
    } finally {
      driverWs.close();
      passengerWs.close();
      bystanderWs.close();
      adminWs.close();
    }
  });

  it("rejects a LOCATION_UPDATE sent by a non-driver connection", async () => {
    const passengerJar = await registerPassenger(uniqueEmail("loc-nondriver"));
    const ws = await connectViaCookie(passengerJar.header());
    try {
      ws.send(JSON.stringify({ type: "LOCATION_UPDATE", lat: 44.05, lng: -71.1 }));
      const msg = await expectMessage(ws);
      expect(msg.type).toBe("ERROR");
    } finally {
      ws.close();
    }
  });

  it("rejects out-of-range coordinates", async () => {
    const driver = await registerDriver(uniqueEmail("loc-badcoords"), 44.06, -71.1);
    const ws = await connectViaCookie(driver.jar.header());
    try {
      ws.send(JSON.stringify({ type: "LOCATION_UPDATE", lat: 200, lng: -71.1 }));
      const msg = await expectMessage(ws);
      expect(msg.type).toBe("ERROR");
    } finally {
      ws.close();
    }
  });

  it("rate-limits a connection after 30 location updates within the window", async () => {
    const driver = await registerDriver(uniqueEmail("loc-ratelimit"), 44.07, -71.1);
    const ws = await connectViaCookie(driver.jar.header());
    try {
      for (let i = 0; i < 30; i++) {
        ws.send(JSON.stringify({ type: "LOCATION_UPDATE", lat: 44.07, lng: -71.1 }));
      }
      ws.send(JSON.stringify({ type: "LOCATION_UPDATE", lat: 44.07, lng: -71.1 }));
      const msg = await expectMessage(ws);
      expect(msg.type).toBe("RATE_LIMITED");
    } finally {
      ws.close();
    }
  });
});
