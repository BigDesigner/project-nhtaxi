import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decryptDocument, encryptDocument } from "./document-encryption";

describe("document envelope encryption", () => {
  it("round-trips arbitrary bytes", async () => {
    const plaintext = new TextEncoder().encode("driver license PDF bytes go here");
    const encrypted = await encryptDocument(env.DOCUMENT_ENCRYPTION_KEY, plaintext);

    expect(new Uint8Array(encrypted.ciphertext)).not.toEqual(plaintext);

    const decrypted = await decryptDocument(env.DOCUMENT_ENCRYPTION_KEY, encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe("driver license PDF bytes go here");
  });

  it("produces a different ciphertext and wrapped key each time (random IVs/data key)", async () => {
    const plaintext = new TextEncoder().encode("same content");
    const a = await encryptDocument(env.DOCUMENT_ENCRYPTION_KEY, plaintext);
    const b = await encryptDocument(env.DOCUMENT_ENCRYPTION_KEY, plaintext);

    expect(a.wrappedKey).not.toBe(b.wrappedKey);
    expect(a.fileIv).not.toBe(b.fileIv);
  });

  it("fails to decrypt with the wrong master key", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await encryptDocument(env.DOCUMENT_ENCRYPTION_KEY, plaintext);

    const wrongKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await expect(decryptDocument(wrongKey, encrypted)).rejects.toThrow();
  });
});
