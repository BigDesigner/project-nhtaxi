import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, usersTable } from "@gnncab/db";
import { capturedEmails, resetCapturedEmails } from "../../test/stub-routing";
import { getAdminEmails, sendEmail } from "./email";

afterEach(() => resetCapturedEmails());

describe("sendEmail — graceful no-ops without a configured Brevo key", () => {
  it("resolves without throwing, and never touches the network, when the key is unset", async () => {
    // The stub-routing guard throws on any unexpected outbound request — this
    // resolving cleanly is itself proof the early-return branch fired rather
    // than a real (or even stubbed) fetch.
    await expect(
      sendEmail(undefined, { to: [{ email: "a@example.com" }], subject: "s", htmlContent: "<p>x</p>" })
    ).resolves.toBeUndefined();
    expect(capturedEmails()).toHaveLength(0);
  });

  it("resolves without throwing when the key is an empty string", async () => {
    await expect(
      sendEmail("", { to: [{ email: "a@example.com" }], subject: "s", htmlContent: "<p>x</p>" })
    ).resolves.toBeUndefined();
    expect(capturedEmails()).toHaveLength(0);
  });

  it("skips the send entirely when there is nobody to send it to, even with a real key", async () => {
    await expect(sendEmail("fake-key", { to: [], subject: "s", htmlContent: "<p>x</p>" })).resolves.toBeUndefined();
    expect(capturedEmails()).toHaveLength(0);
  });
});

describe("sendEmail — with a key configured", () => {
  it("posts the exact shape Brevo expects", async () => {
    await sendEmail("fake-key", {
      to: [{ email: "pat@example.com", name: "Pat" }],
      subject: "Welcome to NH Taxi",
      htmlContent: "<p>hi</p>",
    });

    const [sent] = capturedEmails();
    expect(sent).toBeDefined();
    expect(sent!.to).toEqual([{ email: "pat@example.com", name: "Pat" }]);
    expect(sent!.subject).toBe("Welcome to NH Taxi");
    expect(sent!.htmlContent).toBe("<p>hi</p>");
    expect(sent!.sender.email).toBeTruthy();
  });

  it("swallows a non-2xx response rather than throwing — a delivery failure must not break the caller", async () => {
    // Brevo rejects anything without a valid key; "fake-key" would really 401
    // in production, but the point here is the same for any failure: the
    // caller (a registration, a password change) must complete regardless.
    await expect(
      sendEmail("fake-key", { to: [{ email: "a@example.com" }], subject: "s", htmlContent: "<p>x</p>" })
    ).resolves.toBeUndefined();
  });
});

describe("getAdminEmails", () => {
  it("returns only active admins, not drivers, passengers, or deactivated admins", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();

    const [activeAdmin] = await db
      .insert(usersTable)
      .values({
        email: `admin-active-${suffix}@example.com`,
        passwordHash: "x",
        firstName: "Ada",
        lastName: "Min",
        role: "admin",
      })
      .returning();

    const [deactivatedAdmin] = await db
      .insert(usersTable)
      .values({
        email: `admin-deactivated-${suffix}@example.com`,
        passwordHash: "x",
        firstName: "Old",
        lastName: "Admin",
        role: "admin",
        isActive: false,
      })
      .returning();

    await db.insert(usersTable).values({
      email: `driver-${suffix}@example.com`,
      passwordHash: "x",
      firstName: "Dan",
      lastName: "Driver",
      role: "driver",
    });

    const emails = await getAdminEmails(db);
    const returned = emails.map((e) => e.email);

    expect(returned).toContain(activeAdmin!.email);
    expect(returned).not.toContain(deactivatedAdmin!.email);
    expect(returned).not.toContain(`driver-${suffix}@example.com`);

    // Cleanup so this file's shared storage doesn't leak admins into later
    // tests in the same file that assert an exact admin count.
    await db.delete(usersTable).where(eq(usersTable.id, activeAdmin!.id));
    await db.delete(usersTable).where(eq(usersTable.id, deactivatedAdmin!.id));
  });
});
