/**
 * Google Play purchase verification (for store flavors only).
 *
 * Direct-download builds — the only builds we ship on the $0 budget — use
 * web checkout (Stripe/LemonSqueezy). These code paths activate only if a
 * Play Store flavor is ever published: POST /v1/webhooks/play receives the
 * RTDN push, then we verify the purchase server-side with the Play Developer
 * API before granting entitlement. Never trust the client-side purchase
 * token alone.
 */
import type { Env } from "../env.js";
import { b64urlEncode, nowSec } from "../util/crypto.js";

const te = new TextEncoder();
const td = new TextDecoder();

export interface PlayVerification {
  ok: boolean;
  productId: string;
  purchaseToken: string;
  /** Epoch millis when the subscription expires (null for consumables). */
  expiryTimeMillis: number | null;
  autoRenewing: boolean;
  /** 0 = purchased, 1 = canceled — see Play docs. */
  purchaseState: number | null;
  /**
   * Our user id, echoed back when the client set obfuscatedAccountId to the
   * VeilVPN user id at purchase time. This is how an RTDN notification is
   * attributed to an account — the token alone is never trusted.
   */
  obfuscatedAccountId: string | null;
  error?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(env: Env): ServiceAccount | null {
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return null;
  try {
    const j = JSON.parse(
      env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    ) as Partial<ServiceAccount>;
    if (j.client_email && j.private_key) return j as ServiceAccount;
  } catch {
    return null;
  }
  return null;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----\s*[^-]*-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** OAuth2 access token for the Android Publisher scope, via service-account JWT. */
async function playAccessToken(sa: ServiceAccount): Promise<string> {
  const now = nowSec();
  const header = b64urlEncode(
    te.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claims = b64urlEncode(
    te.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    te.encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${b64urlEncode(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok)
    throw new Error(`play oauth token exchange failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("play oauth returned no access token");
  return data.access_token;
}

/**
 * Verify a Play purchase token with the Android Publisher API.
 * kind "subs" → purchases.subscriptions.get, "inapp" → purchases.products.get.
 */
export async function verifyPlayPurchase(
  env: Env,
  packageName: string,
  productId: string,
  purchaseToken: string,
  kind: "subs" | "inapp",
): Promise<PlayVerification> {
  const sa = parseServiceAccount(env);
  if (!sa) {
    return {
      ok: false,
      productId,
      purchaseToken,
      expiryTimeMillis: null,
      autoRenewing: false,
      purchaseState: null,
      obfuscatedAccountId: null,
      error: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured",
    };
  }
  try {
    const token = await playAccessToken(sa);
    const base =
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
    const url =
      kind === "subs"
        ? `${base}/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`
        : `${base}/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404 || res.status === 400) {
      return {
        ok: false,
        productId,
        purchaseToken,
        expiryTimeMillis: null,
        autoRenewing: false,
        purchaseState: null,
        obfuscatedAccountId: null,
        error: `purchase not found (${res.status})`,
      };
    }
    if (!res.ok) throw new Error(`play purchases.get failed (${res.status})`);
    const p = (await res.json()) as Record<string, unknown>;
    const purchaseState =
      typeof p["purchaseState"] === "number"
        ? (p["purchaseState"] as number)
        : null;
    const expiryTimeMillis =
      typeof p["expiryTimeMillis"] === "string"
        ? parseInt(p["expiryTimeMillis"] as string, 10)
        : null;
    const autoRenewing = p["autoRenewing"] === true;
    const obfuscatedAccountId =
      typeof p["obfuscatedExternalAccountId"] === "string"
        ? (p["obfuscatedExternalAccountId"] as string)
        : null;
    const ok =
      kind === "subs"
        ? purchaseState === 0 &&
          expiryTimeMillis != null &&
          expiryTimeMillis > Date.now()
        : purchaseState === 0;
    return {
      ok,
      productId,
      purchaseToken,
      expiryTimeMillis,
      autoRenewing,
      purchaseState,
      obfuscatedAccountId,
    };
  } catch (err) {
    return {
      ok: false,
      productId,
      purchaseToken,
      expiryTimeMillis: null,
      autoRenewing: false,
      purchaseState: null,
      obfuscatedAccountId: null,
      error: err instanceof Error ? err.message : "play verification failed",
    };
  }
}

/** RTDN push message shape (Pub/Sub push → our webhook). */
export interface RtdnEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
}

export interface RtdnNotification {
  version: string;
  packageName: string;
  eventTimeMillis: number;
  testNotification?: { version: string };
  subscriptionNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
  oneTimeProductNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    sku: string;
  };
}

/** Decode the base64 RTDN payload. Returns null on malformed input. */
export function parseRtdn(envelope: RtdnEnvelope): RtdnNotification | null {
  const data = envelope.message?.data;
  if (!data) return null;
  try {
    let b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(td.decode(bytes)) as RtdnNotification;
  } catch {
    return null;
  }
}
