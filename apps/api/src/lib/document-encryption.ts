import { base64ToBuffer, bufferToBase64 } from "./base64";

// L19 — envelope encryption for sensitive driver documents (license,
// background check, photo). Each file gets its own random AES-GCM data key;
// that key is wrapped (encrypted) with a master key derived from the
// DOCUMENT_ENCRYPTION_KEY Workers Secret. R2's own transport (TLS) and
// at-rest encryption already cover the basics — this is the extra
// application-layer layer so a leaked R2 bucket alone isn't enough to read
// a document, and every read still goes through the Worker (auditable).

export interface EncryptedDocument {
  ciphertext: ArrayBuffer;
  fileIv: string; // base64
  wrappedKey: string; // base64
  wrapIv: string; // base64
}

async function importMasterKey(masterKeyB64: string): Promise<CryptoKey> {
  const keyBytes = base64ToBuffer(masterKeyB64);
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", true, ["wrapKey", "unwrapKey"]);
}

export async function encryptDocument(masterKeyB64: string, plaintext: BufferSource): Promise<EncryptedDocument> {
  const masterKey = await importMasterKey(masterKeyB64);

  // AES-GCM key generation never returns a CryptoKeyPair (that's only for
  // asymmetric algorithms) — the overloaded lib.dom signature just can't
  // narrow that from this call shape.
  const dataKey = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ])) as CryptoKey;
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv as BufferSource }, dataKey, plaintext);

  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey("raw", dataKey, masterKey, {
    name: "AES-GCM",
    iv: wrapIv as BufferSource,
  });

  return {
    ciphertext,
    fileIv: bufferToBase64(fileIv),
    wrappedKey: bufferToBase64(wrappedKey),
    wrapIv: bufferToBase64(wrapIv),
  };
}

export async function decryptDocument(masterKeyB64: string, encrypted: EncryptedDocument): Promise<ArrayBuffer> {
  const masterKey = await importMasterKey(masterKeyB64);

  const dataKey = await crypto.subtle.unwrapKey(
    "raw",
    base64ToBuffer(encrypted.wrappedKey) as BufferSource,
    masterKey,
    { name: "AES-GCM", iv: base64ToBuffer(encrypted.wrapIv) as BufferSource },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuffer(encrypted.fileIv) as BufferSource },
    dataKey,
    encrypted.ciphertext
  );
}
