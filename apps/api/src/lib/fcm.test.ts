import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "@gnncab/db";
import { sendPushToDriver, sendPushToUser, signServiceAccountJwt, type ServiceAccount } from "./fcm";

function base64UrlDecode(b64url: string): Uint8Array {
  const padded = b64url + "=".repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlDecode(b64url));
}

function pemEncode(der: ArrayBuffer): string {
  const bytes = new Uint8Array(der);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function generateTestServiceAccount(): Promise<{ serviceAccount: ServiceAccount; publicKey: CryptoKey }> {
  // generateKey's return type is ambiguous to TS for this algorithm shape
  // (CryptoKey | CryptoKeyPair) even though RSASSA-PKCS1-v1_5 always yields
  // a pair — same cast pattern as lib/document-encryption.ts.
  const keyPair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)) as ArrayBuffer;
  return {
    serviceAccount: {
      project_id: "test-project",
      client_email: "test@test-project.iam.gserviceaccount.com",
      private_key: pemEncode(pkcs8),
    },
    publicKey: keyPair.publicKey,
  };
}

describe("lib/fcm — service-account JWT signing (no real Firebase credentials needed)", () => {
  it("produces a well-formed JWT whose signature verifies against the matching public key", async () => {
    const { serviceAccount, publicKey } = await generateTestServiceAccount();
    const now = Math.floor(Date.now() / 1000);

    const jwt = await signServiceAccountJwt(serviceAccount, now);
    const [headerB64, claimsB64, signatureB64] = jwt.split(".");
    expect(headerB64).toBeTruthy();
    expect(claimsB64).toBeTruthy();
    expect(signatureB64).toBeTruthy();

    const header = JSON.parse(base64UrlDecodeToString(headerB64!));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });

    const claims = JSON.parse(base64UrlDecodeToString(claimsB64!));
    expect(claims.iss).toBe(serviceAccount.client_email);
    expect(claims.sub).toBe(serviceAccount.client_email);
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.iat).toBe(now);
    expect(claims.exp).toBe(now + 3600);

    const signedData = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
    const signature = base64UrlDecode(signatureB64!);
    const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signedData);
    expect(isValid).toBe(true);
  });

  it("produces a different, still-valid signature for different claims (sanity check against a hardcoded pass)", async () => {
    const { serviceAccount, publicKey } = await generateTestServiceAccount();
    const jwtA = await signServiceAccountJwt(serviceAccount, 1000);
    const jwtB = await signServiceAccountJwt(serviceAccount, 2000);
    expect(jwtA).not.toBe(jwtB);

    const [, claimsB64] = jwtB.split(".");
    const claims = JSON.parse(base64UrlDecodeToString(claimsB64!));
    expect(claims.iat).toBe(2000);

    // A signature from a DIFFERENT keypair must not verify against this one.
    const other = await generateTestServiceAccount();
    const jwtWrongKey = await signServiceAccountJwt(other.serviceAccount, 1000);
    const [headerB64, claimsB64A, signatureB64A] = jwtA.split(".");
    const [, , signatureB64Wrong] = jwtWrongKey.split(".");
    const signedData = new TextEncoder().encode(`${headerB64}.${claimsB64A}`);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlDecode(signatureB64A!), signedData)).toBe(true);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlDecode(signatureB64Wrong!), signedData)).toBe(
      false
    );
  });
});

describe("lib/fcm — graceful no-ops without real Firebase credentials", () => {
  it("sendPushToUser resolves without throwing when the service-account key is unset", async () => {
    const db = createDb(env.DB);
    await expect(sendPushToUser(db, "", "some-user-id", { title: "t", body: "b" })).resolves.toBeUndefined();
  });

  it("sendPushToUser resolves without throwing when the service-account key is invalid JSON", async () => {
    const db = createDb(env.DB);
    await expect(sendPushToUser(db, "{not valid json", "some-user-id", { title: "t", body: "b" })).resolves.toBeUndefined();
  });

  it("sendPushToDriver resolves without throwing for a driver profile that doesn't exist", async () => {
    const db = createDb(env.DB);
    await expect(
      sendPushToDriver(db, "", "00000000-0000-0000-0000-000000000000", { title: "t", body: "b" })
    ).resolves.toBeUndefined();
  });
});
