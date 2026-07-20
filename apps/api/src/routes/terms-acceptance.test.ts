import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CURRENT_TERMS_VERSION } from "@gnncab/contract";
import { createDb, usersTable } from "@gnncab/db";
import { readJson, req, uniqueEmail } from "../test-utils/http";

/**
 * You cannot get an account without agreeing, and we can prove what you
 * agreed to.
 *
 * These are the tests that make the consent real rather than decorative: the
 * UI checkbox is a courtesy, but the server is what actually refuses.
 */

const PASSENGER = {
  firstName: "Pat",
  lastName: "Passenger",
  phone: "+16035550500",
  password: "correct horse battery staple",
};

const DRIVER = {
  firstName: "Dan",
  lastName: "Driver",
  phone: "+16035550501",
  password: "correct horse battery staple",
};

describe("terms acceptance is required to register", () => {
  it("refuses a passenger who did not accept", async () => {
    const res = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...PASSENGER, email: uniqueEmail("terms-no") }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a passenger who sends acceptance as false", async () => {
    // `z.literal(true)` rather than `z.boolean()`: sending false must fail
    // outright, not quietly record a "no".
    const res = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...PASSENGER,
        email: uniqueEmail("terms-false"),
        acceptedTerms: false,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a driver who did not accept", async () => {
    const res = await req("/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DRIVER, email: uniqueEmail("terms-driver-no") }),
    });
    expect(res.status).toBe(400);
  });

  it("records when a passenger accepted, and which wording they saw", async () => {
    const email = uniqueEmail("terms-recorded");
    const before = new Date();

    const res = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...PASSENGER,
        email,
        acceptedTerms: true,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      }),
    });
    expect(res.status).toBe(201);

    const db = createDb(env.DB);
    const [user] = await db
      .select({ acceptedAt: usersTable.termsAcceptedAt, version: usersTable.termsVersion })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    // The version matters as much as the timestamp: "they agreed" is worth
    // little in a dispute without being able to say what they agreed to.
    expect(user!.version).toBe(CURRENT_TERMS_VERSION);
    expect(user!.acceptedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("records the same for a driver, who accepts a different document", async () => {
    const email = uniqueEmail("terms-driver-recorded");

    const res = await req("/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...DRIVER,
        email,
        acceptedAgreement: true,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      }),
    });
    expect(res.status).toBe(201);

    const db = createDb(env.DB);
    const [user] = await db
      .select({ acceptedAt: usersTable.termsAcceptedAt, version: usersTable.termsVersion })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    expect(user!.version).toBe(CURRENT_TERMS_VERSION);
    expect(user!.acceptedAt).not.toBeNull();
  });
});
