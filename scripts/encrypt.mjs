// Per-user encryption for the published snapshot.
//
// Every study team member has their own username and password. Nothing is
// checked against a server; instead the password is what unlocks that person's
// copy of the data key.
//
//   users.json (local, never committed) holds one record per person:
//     - an RSA-OAEP key pair, created when the user is added
//     - the private key, encrypted with AES-256-GCM under a key derived from
//       their password by PBKDF2-SHA256
//     - the public key, in the clear
//   Passwords themselves are never written anywhere.
//
//   Each snapshot build:
//     - encrypts the snapshot with a fresh random AES-256-GCM data key
//     - encrypts that data key once per user, with their public key
//     - publishes the ciphertext plus, per user, the wrapped private key and
//       the wrapped data key
//
//   In the browser: password -> PBKDF2 -> unwrap private key -> unwrap data
//   key -> decrypt snapshot. A wrong username or password yields nothing.
//
// Removing a user and rebuilding locks them out of that build and every later
// one, because the new data key is never encrypted for them. Copies of older
// snapshot files they already had stay readable to them.
//
// Both sides use WebCrypto, so the browser decrypts with exactly the
// primitives Node encrypted with. WebCrypto is only available in a secure
// context, so the site must be served over HTTPS (localhost is exempt).

import { webcrypto as crypto } from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KDF_ITERATIONS = 310_000;
export const MIN_PASSWORD_LENGTH = 12;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const RSA = {
  name: "RSA-OAEP",
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

const b64 = (buf) => Buffer.from(buf).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---- users file -------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const USERS_FILE = process.env.A4A_USERS || path.resolve(__dirname, "..", "users.json");

export function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")).users || [];
}

export function saveUsers(users) {
  const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username));
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: sorted }, null, 2) + "\n", { mode: 0o600 });
}

// ---- usernames ----------------------------------------------------------------

export const normalizeUsername = (u) => String(u || "").trim().toLowerCase();
export const isValidUsername = (u) => /^[a-z0-9._@+-]{2,64}$/.test(u);

// The published file lists users by a hash of their username, not the name
// itself, so the list of team members is not readable from the file. Mirrors
// userId() in src/dashboard/decrypt.js.
export async function userId(username) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`a4a-user:${normalizeUsername(username)}`)
  );
  return b64(digest);
}

// ---- keys ---------------------------------------------------------------------

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
    ["encrypt"]
  );
}

/** Creates the stored record for one user. The password is used and dropped. */
export async function createUser(username, password) {
  const name = normalizeUsername(username);
  const pair = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);

  const salt = random(SALT_BYTES);
  const iv = random(IV_BYTES);
  const kek = await passwordKey(password, salt, KDF_ITERATIONS);
  const encPrivateKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, pkcs8);

  return {
    username: name,
    id: await userId(name),
    createdAt: new Date().toISOString(),
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    encPrivateKey: b64(encPrivateKey),
    publicKey: b64(spki),
  };
}

// ---- snapshot -----------------------------------------------------------------

/**
 * @param plaintext the JSON string to protect
 * @param users     records from users.json
 * @param parts     optional { name: jsonString } of extra files encrypted with
 *                  the same data key, e.g. the LLM log. They are gzipped first,
 *                  because ciphertext does not compress in transit.
 * @returns { snapshot, parts }: envelopes safe to publish
 */
export async function encryptSnapshot(plaintext, users, parts = {}) {
  if (!users.length) throw new Error("No users to encrypt the snapshot for.");

  const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawDataKey = await crypto.subtle.exportKey("raw", dataKey);
  const iv = random(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    dataKey,
    new TextEncoder().encode(plaintext)
  );

  const access = await Promise.all(
    users.map(async (u) => {
      const pub = await crypto.subtle.importKey("spki", fromB64(u.publicKey), RSA, false, ["encrypt"]);
      const encDataKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawDataKey);
      return {
        id: u.id,
        iterations: u.iterations,
        salt: u.salt,
        iv: u.iv,
        encPrivateKey: u.encPrivateKey,
        encDataKey: b64(encDataKey),
      };
    })
  );

  const encryptedParts = {};
  for (const [name, text] of Object.entries(parts)) {
    const partIv = random(IV_BYTES);
    const partCiphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: partIv },
      dataKey,
      zlib.gzipSync(Buffer.from(text, "utf8"), { level: 6 })
    );
    encryptedParts[name] = {
      a4aEncrypted: 2,
      part: name,
      compression: "gzip",
      cipher: "AES-GCM",
      iv: b64(partIv),
      ciphertext: b64(partCiphertext),
    };
  }

  const snapshot = {
    a4aEncrypted: 2,
    scheme: "per-user",
    kdf: "PBKDF2-SHA256",
    cipher: "AES-GCM",
    wrap: "RSA-OAEP-3072-SHA256",
    iv: b64(iv),
    ciphertext: b64(ciphertext),
    users: access,
  };
  return { snapshot, parts: encryptedParts };
}
