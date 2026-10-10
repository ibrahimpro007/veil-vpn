/**
 * TOTP (RFC 6238 / RFC 4226) implemented on WebCrypto — no dependencies.
 * Used for admin console second-factor authentication.
 */
import { timingSafeEqual } from "./crypto.js";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input
    .replace(/=+$/, "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

/** HOTP per RFC 4226 with HMAC-SHA1. */
export async function hotpSha1(
  secret: Uint8Array,
  counter: bigint,
  digits = 6,
): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, msg as BufferSource),
  );
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

export interface TotpOptions {
  digits?: number;
  stepSec?: number;
  /** How many steps of clock skew to accept on each side. */
  window?: number;
  /** Unix seconds; defaults to now. Exposed for tests (RFC 6238 vectors). */
  atSec?: number;
}

/** Generate the TOTP code for a base32 secret at a given time. */
export async function totpCode(
  secretB32: string,
  opts: TotpOptions = {},
): Promise<string> {
  const {
    digits = 6,
    stepSec = 30,
    atSec = Math.floor(Date.now() / 1000),
  } = opts;
  const counter = BigInt(Math.floor(atSec / stepSec));
  return hotpSha1(base32Decode(secretB32), counter, digits);
}

/** Verify a user-supplied code, accepting ±window steps of clock skew. */
export async function verifyTotp(
  secretB32: string,
  code: string,
  opts: TotpOptions = {},
): Promise<boolean> {
  const {
    digits = 6,
    stepSec = 30,
    window = 1,
    atSec = Math.floor(Date.now() / 1000),
  } = opts;
  const clean = code.trim();
  if (!/^\d+$/.test(clean) || clean.length !== digits) return false;
  const secret = base32Decode(secretB32);
  const t = Math.floor(atSec / stepSec);
  for (let d = -window; d <= window; d++) {
    const candidate = await hotpSha1(secret, BigInt(t + d), digits);
    if (timingSafeEqual(candidate, clean)) return true;
  }
  return false;
}

/** New 160-bit TOTP secret (base32), per RFC 4226 recommendation. */
export function newTotpSecret(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return base32Encode(b);
}

/** otpauth:// URI for QR-code enrollment in an authenticator app. */
export function totpProvisioningUri(
  secretB32: string,
  account: string,
  issuer = "VeilVPN Admin",
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30&algorithm=SHA1`;
}
