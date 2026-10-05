// Encrypts the snapshot so the published file is useless without the passphrase.
//
// AES-256-GCM with a key derived by PBKDF2-SHA256. Both sides use WebCrypto, so
// the browser decrypts with exactly the primitives Node encrypted with.
//
// The output carries the salt and IV in the clear, which is normal: they are not
// secrets. What protects the data is the passphrase and the KDF cost.
//
// Note for deployment: WebCrypto is only available in a secure context, so the
// site must be served over HTTPS (localhost is exempt).

import { webcrypto as crypto } from "node:crypto";

export const KDF_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const b64 = (buf) => Buffer.from(buf).toString("base64");

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

/**
 * @param plaintext  the JSON string to protect
 * @param passphrase the shared passphrase
 * @returns an envelope safe to publish
 */
export async function encryptSnapshot(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    a4aEncrypted: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-GCM",
    iterations: KDF_ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ciphertext),
  };
}
