/**
 * Apple App Store Server Notifications v2 verification (for store flavors only).
 *
 * Direct-download builds — the only builds we ship on the $0 budget — use
 * web checkout. These paths activate only if an App Store flavor is ever
 * published.
 *
 * Verification performed here (all real, WebCrypto, no dependencies):
 *  1. JWS structural validation (3 parts, alg ES256, x5c present).
 *  2. x5c certificate-chain validation with a minimal DER parser:
 *     - each certificate's issuer Name bytes equal the next certificate's
 *       subject Name bytes,
 *     - each certificate's signature verifies over its tbsCertificate with
 *       the issuer's P-256 public key (ECDSA/SHA-256),
 *     - the root is self-signed and its subject contains "Apple Root CA"
 *       (root pinning by subject),
 *     - the leaf is within its validity window.
 *  3. JWS signature verification with the leaf certificate's P-256 key.
 *
 * Out of scope (documented, not stubbed): full RFC 5280 path validation —
 * name constraints, key-usage extensions, and CRL/OCSP revocation checks.
 * For a production store flavor, add revocation checking against Apple's
 * published CRL on top of this.
 */
import { b64urlDecode, nowSec } from "../util/crypto.js";

const te = new TextEncoder();
const td = new TextDecoder();

/* ---------------- minimal DER reader ---------------- */

interface Tlv {
  tag: number;
  start: number;
  headerLen: number;
  contentLen: number;
}

function readTlv(der: Uint8Array, offset: number): Tlv {
  if (offset + 2 > der.length) throw new Error("DER truncated");
  const tag = der[offset];
  let len = der[offset + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || offset + 2 + n > der.length)
      throw new Error("bad DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | der[offset + 2 + i];
    headerLen = 2 + n;
  }
  if (offset + headerLen + len > der.length) throw new Error("DER truncated");
  return { tag, start: offset, headerLen, contentLen: len };
}

function tlvBytes(der: Uint8Array, t: Tlv): Uint8Array {
  return der.subarray(t.start, t.start + t.headerLen + t.contentLen);
}

function contentBytes(der: Uint8Array, t: Tlv): Uint8Array {
  return der.subarray(
    t.start + t.headerLen,
    t.start + t.headerLen + t.contentLen,
  );
}

function children(der: Uint8Array, t: Tlv): Tlv[] {
  if ((t.tag & 0x20) === 0) throw new Error("DER: expected constructed type");
  const out: Tlv[] = [];
  let o = t.start + t.headerLen;
  const end = o + t.contentLen;
  while (o < end) {
    const c = readTlv(der, o);
    out.push(c);
    o = c.start + c.headerLen + c.contentLen;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function containsAscii(haystack: Uint8Array, needle: string): boolean {
  const n = te.encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

/* ---------------- X.509 subset ---------------- */

interface ParsedCert {
  tbsDer: Uint8Array;
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  spkiDer: Uint8Array;
  /** DER-encoded ECDSA signature (converted to raw before verify). */
  sigDer: Uint8Array;
  notBefore: number;
  notAfter: number;
}

function parseDerTime(tag: number, bytes: Uint8Array): number {
  const s = td.decode(bytes);
  let y: number, mo: number, d: number, h: number, mi: number, sec: number;
  if (tag === 0x17) {
    // UTCTime YYMMDDHHMMSSZ
    if (s.length < 13) throw new Error("bad UTCTime");
    y = parseInt(s.slice(0, 2), 10);
    y += y >= 50 ? 1900 : 2000;
    mo = parseInt(s.slice(2, 4), 10);
    d = parseInt(s.slice(4, 6), 10);
    h = parseInt(s.slice(6, 8), 10);
    mi = parseInt(s.slice(8, 10), 10);
    sec = parseInt(s.slice(10, 12), 10);
  } else if (tag === 0x18) {
    // GeneralizedTime YYYYMMDDHHMMSSZ
    if (s.length < 15) throw new Error("bad GeneralizedTime");
    y = parseInt(s.slice(0, 4), 10);
    mo = parseInt(s.slice(4, 6), 10);
    d = parseInt(s.slice(6, 8), 10);
    h = parseInt(s.slice(8, 10), 10);
    mi = parseInt(s.slice(10, 12), 10);
    sec = parseInt(s.slice(12, 14), 10);
  } else {
    throw new Error("unexpected time tag");
  }
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, sec) / 1000);
}

function parseCert(der: Uint8Array): ParsedCert {
  const cert = readTlv(der, 0);
  if (cert.tag !== 0x30) throw new Error("not a DER SEQUENCE (certificate)");
  const [tbs, , sigValue] = children(der, cert);
  if (!tbs || !sigValue) throw new Error("malformed certificate");
  const tbsKids = children(der, tbs);
  // tbsCertificate ::= SEQUENCE { [0] version EXPLICIT, serial, sig, issuer,
  //                              validity, subject, spki, ... }
  let i = 0;
  if (tbsKids[0]?.tag === 0xa0) i = 1; // skip [0] EXPLICIT version
  const issuer = tbsKids[i + 2];
  const validity = tbsKids[i + 3];
  const subject = tbsKids[i + 4];
  const spki = tbsKids[i + 5];
  if (!issuer || !validity || !subject || !spki)
    throw new Error("malformed tbsCertificate");
  const [notBeforeTlv, notAfterTlv] = children(der, validity);
  const sigContent = contentBytes(der, sigValue);
  if (sigContent.length < 2) throw new Error("malformed signature BIT STRING");
  return {
    tbsDer: tlvBytes(der, tbs),
    issuerDer: tlvBytes(der, issuer),
    subjectDer: tlvBytes(der, subject),
    spkiDer: tlvBytes(der, spki),
    sigDer: sigContent.subarray(1), // strip unused-bits octet
    notBefore: parseDerTime(notBeforeTlv.tag, contentBytes(der, notBeforeTlv)),
    notAfter: parseDerTime(notAfterTlv.tag, contentBytes(der, notAfterTlv)),
  };
}

/** DER ECDSA signature (SEQ of two INTEGERs) → raw 64-byte R||S. */
function derEcdsaToRaw(sigDer: Uint8Array): Uint8Array {
  const seq = readTlv(sigDer, 0);
  if (seq.tag !== 0x30) throw new Error("bad ECDSA signature");
  const [r, s] = children(sigDer, seq);
  const raw = new Uint8Array(64);
  for (const [part, offset] of [
    [r, 0],
    [s, 32],
  ] as const) {
    const bytes = contentBytes(sigDer, part);
    // strip leading zero padding, then left-pad to 32 bytes
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const v = bytes.subarray(start);
    if (v.length > 32) throw new Error("ECDSA integer too large");
    raw.set(v, offset + 32 - v.length);
  }
  return raw;
}

async function importP256VerifyKey(spkiDer: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    spkiDer as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function b64ToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Validate the x5c chain. Returns the leaf SPKI DER for JWS verification.
 * Throws on any validation failure.
 */
export async function verifyAppleChain(
  x5c: string[],
): Promise<{ leafSpkiDer: Uint8Array }> {
  if (!Array.isArray(x5c) || x5c.length === 0)
    throw new Error("x5c chain is empty");
  const certs = x5c.map((b64) => parseCert(b64ToBytes(b64)));
  const now = nowSec();

  for (let i = 0; i < certs.length - 1; i++) {
    if (!bytesEqual(certs[i].issuerDer, certs[i + 1].subjectDer)) {
      throw new Error(`certificate ${i}: issuer/subject mismatch`);
    }
    const issuerKey = await importP256VerifyKey(certs[i + 1].spkiDer);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      issuerKey,
      derEcdsaToRaw(certs[i].sigDer) as BufferSource,
      certs[i].tbsDer as BufferSource,
    );
    if (!ok) throw new Error(`certificate ${i}: signature invalid`);
  }

  const root = certs[certs.length - 1];
  if (!bytesEqual(root.issuerDer, root.subjectDer))
    throw new Error("root is not self-signed");
  const rootKey = await importP256VerifyKey(root.spkiDer);
  const rootOk = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    rootKey,
    derEcdsaToRaw(root.sigDer) as BufferSource,
    root.tbsDer as BufferSource,
  );
  if (!rootOk) throw new Error("root self-signature invalid");
  if (!containsAscii(root.subjectDer, "Apple Root CA")) {
    throw new Error("chain does not root in an Apple Root CA");
  }

  const leaf = certs[0];
  if (now < leaf.notBefore || now > leaf.notAfter) {
    throw new Error("leaf certificate is not valid at this time");
  }
  return { leafSpkiDer: leaf.spkiDer };
}

export interface StoreKitVerification {
  valid: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

/** Verify an App Store Server API / notification JWS. */
export async function verifyStoreKitJws(
  signedPayload: string,
): Promise<StoreKitVerification> {
  try {
    const parts = signedPayload.split(".");
    if (parts.length !== 3) return { valid: false, error: "not a JWS" };
    let header: { alg?: string; x5c?: string[] };
    try {
      header = JSON.parse(td.decode(b64urlDecode(parts[0]))) as {
        alg?: string;
        x5c?: string[];
      };
    } catch {
      return { valid: false, error: "bad JWS header" };
    }
    if (header.alg !== "ES256")
      return { valid: false, error: `unexpected alg ${header.alg}` };
    const { leafSpkiDer } = await verifyAppleChain(header.x5c ?? []);
    const key = await importP256VerifyKey(leafSpkiDer);
    let sig: Uint8Array;
    try {
      sig = b64urlDecode(parts[2]);
    } catch {
      return { valid: false, error: "bad JWS signature encoding" };
    }
    if (sig.length !== 64)
      return { valid: false, error: "bad ES256 signature length" };
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig as BufferSource,
      te.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return { valid: false, error: "JWS signature invalid" };
    const payload = JSON.parse(td.decode(b64urlDecode(parts[1]))) as Record<
      string,
      unknown
    >;
    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "verification failed",
    };
  }
}
