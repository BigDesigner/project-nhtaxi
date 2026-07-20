import { and, eq } from "drizzle-orm";
import { usersTable, type Database } from "@gnncab/db";

/**
 * Transactional email via Brevo's HTTP API — plain `fetch()`, no SDK. Same
 * reasoning as `lib/fcm.ts`: Brevo's own client libraries assume a Node
 * runtime this Worker doesn't have, and the surface actually needed here is
 * one endpoint with a JSON body.
 *
 * Best-effort throughout, same as push and audit logging: a failed email
 * must never affect the request that triggered it — a signup, a password
 * change, a completed trip all succeed or fail on their own merits. Every
 * caller fires this via `c.executionCtx.waitUntil(sendEmail(...))`.
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// A placeholder until the user has a real inbox on their own domain verified
// with Brevo (required before Brevo will actually deliver on its behalf) —
// change this one constant once that exists, no code elsewhere depends on it.
const SENDER = { name: "GNNcab", email: "no-reply@nhtaxi.com" };

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailInput {
  to: EmailRecipient[];
  subject: string;
  htmlContent: string;
}

/**
 * Sends one email. No-ops (with a log line, not an error) when
 * `BREVO_API_KEY` isn't set — the same rollout pattern as
 * `FCM_SERVICE_ACCOUNT_KEY`: this ships before the secret is provisioned and
 * stays quiet rather than breaking anything until it is.
 */
export async function sendEmail(apiKey: string | undefined, input: EmailInput): Promise<void> {
  if (!apiKey) {
    console.warn("[email] BREVO_API_KEY not set — skipping:", input.subject);
    return;
  }
  if (input.to.length === 0) return;

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        sender: SENDER,
        to: input.to,
        subject: input.subject,
        htmlContent: input.htmlContent,
      }),
    });
    if (!res.ok) {
      console.error("[email] Brevo send failed", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[email] sendEmail threw", err);
  }
}

/**
 * Every active admin's email — the office's shared address for new-signup
 * and trip-completion notices. Works the same whether GNN LLC ever has one
 * admin account or several; nothing else here assumes a single inbox.
 */
export async function getAdminEmails(db: Database): Promise<EmailRecipient[]> {
  const admins = await db
    .select({ email: usersTable.email, firstName: usersTable.firstName })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
  return admins.map((a) => ({ email: a.email, name: a.firstName }));
}
