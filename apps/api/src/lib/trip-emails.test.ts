import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { capturedEmails, resetCapturedEmails } from "../../test/stub-routing";
import { sendTripCompletedEmails } from "./trip-emails";

afterEach(() => resetCapturedEmails());

async function makeCustomer(db: ReturnType<typeof createDb>) {
  const suffix = crypto.randomUUID();
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `pat-${suffix}@example.com`,
      passwordHash: "x",
      firstName: "Pat",
      lastName: "Passenger",
      role: "customer",
    })
    .returning();
  return user!;
}

async function makeDriver(db: ReturnType<typeof createDb>) {
  const suffix = crypto.randomUUID();
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `dan-${suffix}@example.com`,
      passwordHash: "x",
      firstName: "Dan",
      lastName: "Driver",
      role: "driver",
    })
    .returning();
  const [profile] = await db
    .insert(driverProfilesTable)
    .values({ userId: user!.id, status: "AVAILABLE", isVerified: true })
    .returning();
  return { user: user!, profile: profile! };
}

async function makeAdmin(db: ReturnType<typeof createDb>) {
  const suffix = crypto.randomUUID();
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `office-${suffix}@example.com`,
      passwordHash: "x",
      firstName: "Office",
      lastName: "Admin",
      role: "admin",
    })
    .returning();
  return user!;
}

describe("sendTripCompletedEmails", () => {
  it("emails a registered passenger and the office, with driver and fare detail for the office copy", async () => {
    const db = createDb(env.DB);
    const customer = await makeCustomer(db);
    const { profile: driver, user: driverUser } = await makeDriver(db);
    const admin = await makeAdmin(db);

    await sendTripCompletedEmails(db, "fake-key", {
      id: "11111111-1111-4111-8111-111111111111",
      pickupAddress: "Main St",
      dropoffAddress: "Logan Airport",
      distanceMiles: 136.27,
      finalFareCents: 17309,
      currency: "USD",
      driverId: driver.id,
      customerId: customer.id,
      guestName: null,
    });

    const sent = capturedEmails();
    const toCustomer = sent.find((e) => e.to.some((r) => r.email === customer.email));
    const toAdmin = sent.find((e) => e.to.some((r) => r.email === admin.email));

    expect(toCustomer).toBeDefined();
    expect(toCustomer!.subject).toContain("trip is complete");
    expect(toCustomer!.htmlContent).toContain("Logan Airport");
    // The passenger's own copy has no reason to name the driver by name in
    // the summary table — only the office copy does.
    expect(toCustomer!.htmlContent).not.toContain(driverUser.firstName);

    expect(toAdmin).toBeDefined();
    expect(toAdmin!.htmlContent).toContain(driverUser.firstName);
    expect(toAdmin!.htmlContent).toContain("173.09");

    // Storage is shared across tests in this file — leaving this admin behind
    // would make the "no admins" test below false, not just noisy.
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
  });

  it("emails only the office for a guest trip with no registered passenger", async () => {
    // This is the referral-trip case: there was never a booking, so there is
    // no passenger inbox to reach — the office's copy is the only record.
    const db = createDb(env.DB);
    const { profile: driver } = await makeDriver(db);
    const admin = await makeAdmin(db);

    await sendTripCompletedEmails(db, "fake-key", {
      id: "22222222-2222-4222-8222-222222222222",
      pickupAddress: "Eastern Slope Inn",
      dropoffAddress: "Settlers Green",
      distanceMiles: 4.2,
      finalFareCents: 1450,
      currency: "USD",
      driverId: driver.id,
      customerId: null,
      guestName: "Walk-in",
    });

    const sent = capturedEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([{ email: admin.email, name: admin.firstName }]);
    expect(sent[0]!.htmlContent).toContain("Walk-in");

    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
  });

  it("sends nothing to anyone when there are no admins and no registered passenger", async () => {
    const db = createDb(env.DB);
    const { profile: driver } = await makeDriver(db);

    await sendTripCompletedEmails(db, "fake-key", {
      id: "33333333-3333-4333-8333-333333333333",
      pickupAddress: "Main St",
      dropoffAddress: "Side St",
      distanceMiles: 1,
      finalFareCents: 500,
      currency: "USD",
      driverId: driver.id,
      customerId: null,
      guestName: null,
    });

    expect(capturedEmails()).toHaveLength(0);
  });
});
