// Browser half of the snapshot encryption. Mirrors scripts/encrypt.mjs, which
// describes the scheme: each user's password unlocks their private key, which
// unlocks the data key, which decrypts the snapshot.
//
// WebCrypto needs a secure context, so this works on HTTPS and on localhost and
// nowhere else. isSupported() lets the UI say so plainly instead of failing with
// an opaque error.

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

export function isEncrypted(payload) {
  return Boolean(payload && payload.a4aEncrypted);
}

/** A file built with the old shared passphrase, which this page no longer opens. */
export function isLegacy(payload) {
  return Boolean(payload && payload.a4aEncrypted && payload.a4aEncrypted !== 2);
}

export function isSupported() {
  return typeof window !== "undefined" && window.isSecureContext && !!window.crypto?.subtle;
}

export const normalizeUsername = (u) => String(u || "").trim().toLowerCase();

async function userId(username) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`a4a-user:${normalizeUsername(username)}`)
  );
  return toB64(digest);
}

async function passwordKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
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

/** Decrypts the snapshot with an already-unwrapped data key. */
export async function openWithKey(payload, rawDataKey) {
  const key = await crypto.subtle.importKey("raw", rawDataKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(payload.iv) }, key, fromB64(payload.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Opens an extra file published beside the snapshot (e.g. the LLM log). It is
 * encrypted with the same data key and gzipped before encryption.
 */
export async function openPart(payload, rawDataKey) {
  const key = await crypto.subtle.importKey("raw", rawDataKey, "AES-GCM", false, ["decrypt"]);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(payload.iv) }, key, fromB64(payload.ciphertext));
  if (payload.compression !== "gzip") return JSON.parse(new TextDecoder().decode(bytes));
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress the log. Use a current Chrome, Edge, Firefox or Safari.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

/**
 * Signs in by decryption. Returns the snapshot and the data key for the
 * session. Throws "bad-credentials" for an unknown user or wrong password;
 * the two are deliberately indistinguishable.
 */
export async function signIn(payload, username, password) {
  const id = await userId(username);
  const entry = (payload.users || []).find((u) => u.id === id);
  if (!entry) throw new Error("bad-credentials");

  const kek = await passwordKey(password, fromB64(entry.salt), entry.iterations);
  let pkcs8;
  try {
    pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(entry.iv) }, kek, fromB64(entry.encPrivateKey));
  } catch {
    throw new Error("bad-credentials");
  }

  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
  const rawDataKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(entry.encDataKey));
  return { snapshot: await openWithKey(payload, rawDataKey), rawDataKey };
}

// The session is held for the tab only, so a shared machine does not keep it
// after the browser closes. Deliberately sessionStorage, not localStorage.
// What is kept is this build's data key, never the password; a rebuilt
// snapshot has a new key, so the session lapses and the sign-in form returns.
const KEY = "a4a.session";

export const rememberSession = (username, rawDataKey) => {
  try { sessionStorage.setItem(KEY, JSON.stringify({ username, key: toB64(rawDataKey) })); } catch { /* private mode */ }
};
export const recallSession = () => {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY));
    return s && s.username && s.key ? { username: s.username, rawDataKey: fromB64(s.key) } : null;
  } catch { return null; }
};
export const forgetSession = () => {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem("a4a.passphrase"); // left by the old shared-passphrase page
  } catch { /* ignore */ }
};
