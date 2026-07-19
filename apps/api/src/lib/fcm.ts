import { eq } from "drizzle-orm";
import { driverProfilesTable, pushTokensTable, type Database } from "@gnncab/db";

// Faz 6 — sends push notifications via FCM's HTTP v1 API directly with
// Web Crypto (no Node/Firebase Admin SDK — those assume a Node runtime,
// unavailable on Workers). The service-account JSON gives us an RSA private
// key; we hand-sign a short-lived JWT, exchange it for an OAuth2 access
// token, then call FCM. Every step is fetch + Web Crypto, both natively
// available in workerd.

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

function base64UrlEncode(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function signServiceAccountJwt(serviceAccount: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

/**
 * No token cache: at this scale (10-20 drivers) the extra OAuth2 round trip
 * per notification is cheap, and Workers isolates are too short-lived/
 * unpredictable to reliably cache a 1-hour token in memory without a KV/DO
 * anyway — not worth the complexity.
 */
async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const assertion = await signServiceAccountJwt(serviceAccount, Math.floor(Date.now() / 1000));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth2 token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function sendToToken(
  serviceAccount: ServiceAccount,
  accessToken: string,
  token: string,
  notification: PushNotification
): Promise<{ ok: true } | { ok: false; invalid: boolean; error: string }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: notification.title, body: notification.body },
        data: notification.data,
      },
    }),
  });
  if (res.ok) return { ok: true };

  const errorBody = await res.text();
  // FCM reports a dead registration token this way — self-clean it so we
  // stop paying the (tiny but nonzero) cost of retrying a dead device forever.
  const invalid = res.status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(errorBody);
  return { ok: false, invalid, error: errorBody };
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

/**
 * Best-effort — never throws. Callers fire this via
 * `c.executionCtx.waitUntil(sendPushToUser(...))`, same as audit logging;
 * a notification failure must never affect the triggering request.
 */
export async function sendPushToUser(
  db: Database,
  fcmServiceAccountKey: string,
  userId: string,
  notification: PushNotification
): Promise<void> {
  if (!fcmServiceAccountKey) return; // not configured yet (Faz 6 rollout gate)

  const serviceAccount = parseServiceAccount(fcmServiceAccountKey);
  if (!serviceAccount) {
    console.error("[fcm] FCM_SERVICE_ACCOUNT_KEY is not valid service-account JSON");
    return;
  }

  try {
    const tokens = await db.select().from(pushTokensTable).where(eq(pushTokensTable.userId, userId));
    if (tokens.length === 0) return;

    const accessToken = await getAccessToken(serviceAccount);
    for (const t of tokens) {
      const result = await sendToToken(serviceAccount, accessToken, t.token, notification);
      if (!result.ok) {
        console.error(`[fcm] send failed for push token ${t.id}: ${result.error}`);
        if (result.invalid) {
          await db.delete(pushTokensTable).where(eq(pushTokensTable.id, t.id));
        }
      }
    }
  } catch (err) {
    console.error("[fcm] sendPushToUser failed", err);
  }
}

export async function sendPushToDriver(
  db: Database,
  fcmServiceAccountKey: string,
  driverProfileId: string,
  notification: PushNotification
): Promise<void> {
  const [driver] = await db
    .select({ userId: driverProfilesTable.userId })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.id, driverProfileId))
    .limit(1);
  if (!driver) return;
  await sendPushToUser(db, fcmServiceAccountKey, driver.userId, notification);
}
