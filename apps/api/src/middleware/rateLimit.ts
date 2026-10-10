import { createMiddleware } from "hono/factory";
import { apiError } from "./errors.js";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Token-bucket rate limiter backed by the RATE_LIMIT KV namespace.
 * Pure-ish: the bucket math is here, KV is only get/put, so it works with
 * the real binding and with the in-memory stub used in tests.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitCheck> {
  const now = Date.now() / 1000;
  let bucket: Bucket = { tokens: limit, updatedAt: now };
  try {
    const raw = await kv.get(`rl:${key}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Bucket>;
      if (
        typeof parsed.tokens === "number" &&
        typeof parsed.updatedAt === "number"
      ) {
        bucket = { tokens: parsed.tokens, updatedAt: parsed.updatedAt };
      }
    }
  } catch {
    // Corrupt bucket → start over (fail open on read errors would be worse
    // than fail-closed; a fresh bucket is the safe middle ground).
  }
  const refillRate = limit / windowSec;
  bucket.tokens = Math.min(
    limit,
    bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillRate,
  );
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    await kv
      .put(`rl:${key}`, JSON.stringify(bucket), {
        expirationTtl: windowSec * 2,
      })
      .catch(() => {});
    return { allowed: true, retryAfterSec: 0 };
  }
  const retryAfterSec = Math.max(
    1,
    Math.ceil((1 - bucket.tokens) / refillRate),
  );
  await kv
    .put(`rl:${key}`, JSON.stringify(bucket), { expirationTtl: windowSec * 2 })
    .catch(() => {});
  return { allowed: false, retryAfterSec };
}

/** Client IP for per-IP buckets (Cloudflare header, then XFF fallback). */
export function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

/** Hono middleware. 429s carry Retry-After + the standard ApiError body. */
export function rateLimit(prefix: string, limit: number, windowSec: number) {
  return createMiddleware(async (c, next) => {
    const key = `${prefix}:${clientIp(c)}`;
    const res = await checkRateLimit(c.env.RATE_LIMIT, key, limit, windowSec);
    if (!res.allowed) {
      c.header("Retry-After", String(res.retryAfterSec));
      return apiError(
        c,
        429,
        "rate_limited",
        "Too many requests. Try again later.",
      );
    }
    await next();
  });
}
