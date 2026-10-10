/**
 * Test helpers: an in-memory D1 stub (backed by node:sqlite, running the REAL
 * migration SQL), an in-memory KV stub, a fully-populated test Env, and a
 * request helper that hits the real Hono app via fetch().
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeDb, type Db } from "../src/db/index.js";
import { plans } from "../src/db/schema.js";
import { nowSec } from "../src/util/crypto.js";
import type { Env } from "../src/env.js";
import api from "../src/index.js";

const te = new TextEncoder();

/* ---------------- D1 stub (node:sqlite backed) ---------------- */

interface D1Meta {
  changes?: number;
  last_row_id?: number | bigint | null;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
}

function normalizeParam(p: unknown): unknown {
  if (typeof p === "boolean") return p ? 1 : 0;
  return p;
}

export class D1Stub {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql: string) {
    const db = this.db;
    const make = (params: unknown[]) => {
      const stmt = db.prepare(sql);
      const norm = params.map(normalizeParam);
      return {
        first<T = Record<string, unknown>>(): T | null {
          const row = stmt.get(...norm);
          return (row ?? null) as T | null;
        },
        all<T = Record<string, unknown>>(): {
          results: T[];
          success: boolean;
          meta: D1Meta;
        } {
          const rows = stmt.all(...norm) as T[];
          return {
            results: rows,
            success: true,
            meta: { rows_read: rows.length, rows_written: 0, duration: 0 },
          };
        },
        run(): { success: boolean; meta: D1Meta } {
          const info = stmt.run(...norm);
          const changes =
            typeof info.changes === "bigint"
              ? Number(info.changes)
              : info.changes;
          return {
            success: true,
            meta: {
              changes,
              last_row_id: info.lastInsertRowid,
              rows_read: 0,
              rows_written: changes,
              duration: 0,
            },
          };
        },
        raw<T = unknown[]>(): T[] {
          const stmt2 = db.prepare(sql);
          const rows = stmt2.all(...norm) as unknown as Record<
            string,
            unknown
          >[];
          return rows.map((r) => Object.values(r)) as T[];
        },
      };
    };
    return {
      bind: (...params: unknown[]) => make(params),
      first: <T>() => make([]).first<T>(),
      all: <T>() => make([]).all<T>(),
      run: () => make([]).run(),
      raw: <T>() => make([]).raw<T>(),
    };
  }

  exec(sql: string) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  async batch(stmts: { run: () => unknown }[]) {
    return stmts.map((s) => s.run());
  }

  close() {
    this.db.close();
  }
}

/* ---------------- KV stub ---------------- */

export class KVStub {
  private map = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt < Date.now() / 1000) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }

  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: opts?.expirationTtl
        ? Date.now() / 1000 + opts.expirationTtl
        : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/* ---------------- test context ---------------- */

export interface TestContext {
  env: Env;
  db: Db;
  d1: D1Stub;
  kv: KVStub;
}

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "d1",
  "migrations",
);

function pemWrap(kind: "PRIVATE KEY" | "PUBLIC KEY", der: ArrayBuffer): string {
  const bytes = new Uint8Array(der);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join("\n")}\n-----END ${kind}-----\n`;
}

async function makeJwtKeys(): Promise<{
  privatePem: string;
  publicPem: string;
}> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey(
    "pkcs8",
    kp.privateKey,
  )) as ArrayBuffer;
  const pub = (await crypto.subtle.exportKey(
    "spki",
    kp.publicKey,
  )) as ArrayBuffer;
  return {
    privatePem: pemWrap("PRIVATE KEY", priv),
    publicPem: pemWrap("PUBLIC KEY", pub),
  };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makeTestContext(): Promise<TestContext> {
  const d1 = new D1Stub();
  // Apply the REAL migrations, in order.
  for (const name of [
    "0001_init.sql",
    "0002_profile_name.sql",
    "0003_provider_customer.sql",
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    d1.exec(sql);
  }
  const db = makeDb(d1 as unknown as D1Database);

  // Seed the three plans (mirrors infra/d1/seed.sql).
  const now = nowSec();
  const seedPlans = [
    {
      id: "plan_free_trial",
      name: "Veil Trial",
      slug: "free-trial",
      priceCents: 0,
      currency: "USD",
      interval: "month",
      deviceLimit: 1,
    },
    {
      id: "plan_monthly",
      name: "Veil Monthly",
      slug: "monthly",
      priceCents: 499,
      currency: "USD",
      interval: "month",
      deviceLimit: 5,
    },
    {
      id: "plan_yearly",
      name: "Veil Yearly",
      slug: "yearly",
      priceCents: 4999,
      currency: "USD",
      interval: "year",
      deviceLimit: 5,
    },
  ];
  for (const p of seedPlans) {
    await db.insert(plans).values({
      id: p.id,
      name: p.name,
      slug: p.slug,
      priceCents: p.priceCents,
      currency: p.currency,
      interval: p.interval,
      deviceLimit: p.deviceLimit,
      providerProductRefs: "{}",
      active: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const kv = new KVStub();
  const { privatePem, publicPem } = await makeJwtKeys();
  const totpKey = new Uint8Array(32);
  crypto.getRandomValues(totpKey);

  const env = {
    DB: d1 as unknown as D1Database,
    RATE_LIMIT: kv as unknown as KVNamespace,
    APP_NAME: "VeilVPN",
    APP_ENV: "test",
    APP_URL: "https://app.test",
    API_PUBLIC_URL: "https://api.test",
    ADMIN_URL: "https://admin.test",
    JWT_ISSUER: "veil-api-test",
    JWT_EDDSA_PRIVATE_KEY: privatePem,
    JWT_EDDSA_PUBLIC_KEY: publicPem,
    RESEND_API_KEY: "",
    EMAIL_FROM: "noreply@test.example",
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
    LEMONSQUEEZY_API_KEY: "lsq_test_dummy",
    LEMONSQUEEZY_WEBHOOK_SECRET: "lsq_whsec_dummy",
    LEMONSQUEEZY_STORE_ID: "store_dummy",
    NODE_AGENT_HMAC_SECRET: "test-node-hmac-secret",
    ADMIN_TOTP_ENC_KEY: b64url(totpKey),
  } as Env;

  return { env, db, d1, kv };
}

/* ---------------- request helper ---------------- */

let ipCounter = 1;

/**
 * Send a request through the real Worker (all middleware + routes).
 * Each call gets a unique client IP unless `ip` is given, so per-IP rate
 * limits don't leak between tests.
 */
export async function treq(
  ctx: TestContext,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    token?: string;
    adminToken?: string;
    headers?: Record<string, string>;
    ip?: string;
  } = {},
): Promise<{ status: number; headers: Headers; json: unknown; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "cf-connecting-ip": opts.ip ?? `127.0.0.${(ipCounter++ % 250) + 1}`,
    ...(opts.headers ?? {}),
  };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.adminToken) headers["Authorization"] = `Bearer ${opts.adminToken}`;
  const req = new Request(`https://api.test${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = (await api.fetch(req, ctx.env)) as Response;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, headers: res.headers, json, text };
}

/** Deterministic 44-char base64 WireGuard-style public key for tests. */
export function testWgKey(seedByte: number): string {
  const b = new Uint8Array(32).fill(seedByte);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

/**
 * Like treq, but sends `rawBody` verbatim (no JSON encoding) — required for
 * webhook signature tests where the signature covers the exact bytes.
 */
export async function treqRaw(
  ctx: TestContext,
  method: string,
  path: string,
  rawBody: string,
  opts: { headers?: Record<string, string>; ip?: string } = {},
): Promise<{ status: number; headers: Headers; json: unknown; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "cf-connecting-ip": opts.ip ?? `127.0.0.${(ipCounter++ % 250) + 1}`,
    ...(opts.headers ?? {}),
  };
  const req = new Request(`https://api.test${path}`, {
    method,
    headers,
    body: rawBody,
  });
  const res = (await api.fetch(req, ctx.env)) as Response;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, headers: res.headers, json, text };
}

export { te };
