import { eq } from "drizzle-orm";
import { driverProfilesTable, usersTable, type Database } from "@gnncab/db";
import { getAdminEmails, sendEmail } from "./email";
import { tripCompletedEmail } from "./email-templates";

export interface CompletedTripInput {
  id: string;
  pickupAddress: string;
  dropoffAddress: string | null;
  distanceMiles: number | null;
  finalFareCents: number | null;
  currency: string;
  driverId: string | null;
  customerId: string | null;
  guestName: string | null;
}

/**
 * The two trip-completion emails: one to the passenger, one to the office.
 *
 * Best-effort, like everything else in `lib/email.ts` — callers fire this via
 * `c.executionCtx.waitUntil(...)`, same as the existing push notification and
 * audit-log calls on this same status transition.
 *
 * A guest booked in by phone (no registered account) has no inbox to reach,
 * so only the admin copy goes out for those trips — that's the office's own
 * record either way, not a gap in the passenger's experience.
 */
export async function sendTripCompletedEmails(db: Database, apiKey: string, trip: CompletedTripInput): Promise<void> {
  let driverName: string | null = null;
  if (trip.driverId) {
    const [row] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(driverProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, driverProfilesTable.userId))
      .where(eq(driverProfilesTable.id, trip.driverId))
      .limit(1);
    if (row) driverName = `${row.firstName} ${row.lastName}`;
  }

  let customerName: string | null = trip.guestName;
  let customerEmail: string | null = null;
  if (trip.customerId) {
    const [row] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, trip.customerId))
      .limit(1);
    if (row) {
      customerName = `${row.firstName} ${row.lastName}`;
      customerEmail = row.email;
    }
  }

  const summary = {
    id: trip.id,
    pickupAddress: trip.pickupAddress,
    dropoffAddress: trip.dropoffAddress,
    distanceMiles: trip.distanceMiles,
    finalFareCents: trip.finalFareCents,
    currency: trip.currency,
    driverName,
    customerName,
  };

  if (customerEmail) {
    const { subject, html } = tripCompletedEmail(summary, "customer");
    await sendEmail(apiKey, { to: [{ email: customerEmail, name: customerName ?? undefined }], subject, htmlContent: html });
  }

  const adminEmails = await getAdminEmails(db);
  if (adminEmails.length > 0) {
    const { subject, html } = tripCompletedEmail(summary, "admin");
    await sendEmail(apiKey, { to: adminEmails, subject, htmlContent: html });
  }
}
