/**
 * Cryptographic primitives for the VeilVPN API worker.
 * Everything here runs on WebCrypto so it works identically on
 * Cloudflare Workers and in the Vitest suite (Node 20+).
 */

const te = new TextEncoder();
const td = new TextDecoder();

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Opaque TEXT primary keys. */
export function newId(): string {
  return crypto.randomUUID();
}

/* ---------------- base64 / hex ---------------- */

export function b64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64Encode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function hexEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/* ---------------- hashing ---------------- */

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? te.encode(data) : data;
  return hexEncode(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
}

/**
 * Constant-time comparison for secrets (tokens, signatures, hashes).
 * Returns false on length mismatch without leaking the expected length
 * beyond what the caller already knows.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = te.encode(a);
  const bb = te.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** URL-safe opaque token (32 random bytes by default). */
export function randomToken(numBytes = 32): string {
  const b = new Uint8Array(numBytes);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}

/* ---------------- password hashing ---------------- */

/**
 * OWASP-recommended iteration count for PBKDF2-HMAC-SHA256.
 *
 * Why PBKDF2 and not Argon2id (the Phase 1 notes say "Argon2id preferred"):
 * Cloudflare Workers has no native Argon2, and Argon2id WASM builds blow
 * past Worker CPU/memory limits on the interactive login path (a single
 * hash can exceed the 10–30ms CPU budget many times over and risk OOM in
 * the 128MB isolate). PBKDF2-SHA256 at 600,000 iterations is OWASP's current
 * recommended minimum, runs in constant-time WebCrypto with zero WASM
 * bundle, and verifies in ~250ms. The stored format is self-describing so
 * the algorithm can be migrated later without invalidating existing hashes.
 */
export const PBKDF2_ITERATIONS = 600_000;
const PW_PREFIX = "$pbkdf2-sha256";

export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return `${PW_PREFIX}$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // format: $pbkdf2-sha256$<iterations>$<b64url salt>$<b64url hash>
  const parts = stored.split("$");
  if (parts.length !== 5 || `$${parts[1]}` !== PW_PREFIX) return false;
  const iterations = parseInt(parts[2], 10);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 10_000_000)
    return false;
  let salt: Uint8Array;
  try {
    salt = b64urlDecode(parts[3]);
  } catch {
    return false;
  }
  const expected = parts[4];
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return timingSafeEqual(b64urlEncode(bits), expected);
}

/* ---------------- EdDSA (Ed25519) JWT ---------------- */

export interface JwtClaims {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  /** "access" for user sessions, "admin" for admin console sessions,
      "admin-challenge" for the short-lived TOTP step-up token. */
  typ: "access" | "admin" | "admin-challenge";
  role?: string;
  [key: string]: unknown;
}

function pemToDer(pem: string): Uint8Array {
  // Secrets may be stored with literal "\n" escapes; normalize first.
  const normalized = pem.replace(/\\n/g, "\n");
  const b64 = normalized.replace(/-----\s*[^-]*-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importEdPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

export async function importEdPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToDer(pem) as BufferSource,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

export async function signJwtEdDSA(
  claims: JwtClaims,
  privateKeyPem: string,
  kid = "ed25519-1",
): Promise<string> {
  const header = b64urlEncode(
    te.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid })),
  );
  const body = b64urlEncode(te.encode(JSON.stringify(claims)));
  const key = await importEdPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    te.encode(`${header}.${body}`),
  );
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

/** Returns the claims on success, null on any failure (bad shape, alg, signature, expiry). */
export async function verifyJwtEdDSA(
  token: string,
  publicKeyPem: string,
): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(td.decode(b64urlDecode(h))) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== "EdDSA") return null;
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(s);
  } catch {
    return null;
  }
  let ok = false;
  try {
    const key = await importEdPublicKey(publicKeyPem);
    ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig as BufferSource,
      te.encode(`${h}.${b}`),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  let claims: JwtClaims;
  try {
    claims = JSON.parse(td.decode(b64urlDecode(b))) as JwtClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp <= nowSec()) return null;
  return claims;
}

/* ---------------- HMAC ---------------- */

export async function hmacSha256Hex(
  key: string | Uint8Array,
  message: string | Uint8Array,
): Promise<string> {
  const keyBytes = typeof key === "string" ? te.encode(key) : key;
  const msgBytes = typeof message === "string" ? te.encode(message) : message;
  const ck = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", ck, msgBytes as BufferSource);
  return hexEncode(mac);
}

/* ---------------- AES-GCM (admin TOTP secret storage) ---------------- */

/**
 * Encrypts with AES-256-GCM. ADMIN_TOTP_ENC_KEY is 32 random bytes, base64
 * (standard or URL-safe) encoded. Returns base64url(iv[12] || ciphertext+tag).
 */
export async function aesGcmEncrypt(
  keyB64: string,
  plaintext: string,
): Promise<string> {
  const keyBytes = b64urlDecode(keyB64.replace(/\+/g, "-").replace(/\//g, "_"));
  if (keyBytes.length !== 32)
    throw new Error("ADMIN_TOTP_ENC_KEY must be 32 bytes");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    te.encode(plaintext),
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return b64urlEncode(out);
}

export async function aesGcmDecrypt(
  keyB64: string,
  payloadB64: string,
): Promise<string> {
  const keyBytes = b64urlDecode(keyB64.replace(/\+/g, "-").replace(/\//g, "_"));
  const raw = b64urlDecode(payloadB64);
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return td.decode(pt);
}
