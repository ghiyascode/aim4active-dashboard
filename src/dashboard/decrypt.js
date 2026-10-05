// Browser half of the snapshot encryption. Mirrors scripts/encrypt.mjs.
//
// WebCrypto needs a secure context, so this works on HTTPS and on localhost and
// nowhere else. isSupported() lets the UI say so plainly instead of failing with
// an opaque error.

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function isEncrypted(payload) {
  return Boolean(payload && payload.a4aEncrypted);
}

export function isSupported() {
  return typeof window !== "undefined" && window.isSecureContext && !!window.crypto?.subtle;
}

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
    ["decrypt"]
  );
}

/**
 * Decrypts an envelope produced by the build step.
 * Throws "wrong-passphrase" when authentication fails, which with AES-GCM is
 * the only thing a bad key can produce.
 */
export async function decryptSnapshot(payload, passphrase) {
  const key = await deriveKey(passphrase, fromB64(payload.salt), payload.iterations);

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(payload.iv) },
      key,
      fromB64(payload.ciphertext)
    );
  } catch {
    throw new Error("wrong-passphrase");
  }

  return JSON.parse(new TextDecoder().decode(plaintext));
}

// The passphrase is held for the tab only, so a shared machine does not keep it
// after the browser closes. Deliberately sessionStorage, not localStorage.
const KEY = "a4a.passphrase";

export const rememberPassphrase = (p) => {
  try { sessionStorage.setItem(KEY, p); } catch { /* private mode */ }
};
export const recallPassphrase = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const forgetPassphrase = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};
