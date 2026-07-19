import { base64ToBuffer, bufferToBase64 } from "./base64";

// Edge-native password hashing (Web Crypto PBKDF2) — no bcrypt/argon2
// dependency, since Workers has no native binding for either. Iteration
// count is embedded in the stored string so it can be raised later without
// invalidating existing hashes.
//
// 100,000 is the real ceiling here, not a choice: the live Cloudflare Workers
// edge runtime rejects crypto.subtle.deriveBits({name:"PBKDF2"}) above
// 100,000 iterations ("NotSupportedError: Pbkdf2 failed: iteration counts
// above 100000 are not supported"), even though the locally-bundled workerd
// used by `wrangler dev` and the vitest-pool-workers test runner does NOT
// enforce this cap — this bug shipped past local dev and CI and only
// surfaced in a real production smoke test (Faz 1).
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function deriveHash(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufferToBase64(salt.buffer)}$${bufferToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = base64ToBuffer(parts[2] as string);
  const expected = base64ToBuffer(parts[3] as string);
  const actual = new Uint8Array(await deriveHash(password, salt, iterations));
  return timingSafeEqual(actual, expected);
}
