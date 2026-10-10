/**
 * Login brute-force protection: per-IP and per-account buckets in KV with
 * exponential backoff. After 5 consecutive failures the key is locked for
 * 15 minutes; each further block of 5 failures doubles the lock duration.
 * Success clears both buckets.
 */
import { nowSec } from "../util/crypto.js";

const MAX_FAILURES_BEFORE_LOCK = 5;
const BASE_LOCK_SEC = 15 * 60;

interface LockState {
  failures: number;
  lockedUntil: number;
}

function lockKey(kind: "ip" | "acct", value: string): string {
  return `login:${kind}:${value}`;
}

async function readState(kv: KVNamespace, key: string): Promise<LockState> {
  try {
    const raw = await kv.get(key);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LockState>;
      if (typeof p.failures === "number" && typeof p.lockedUntil === "number") {
        return { failures: p.failures, lockedUntil: p.lockedUntil };
      }
    }
  } catch {
    /* corrupted entry → treat as fresh */
  }
  return { failures: 0, lockedUntil: 0 };
}

async function writeState(
  kv: KVNamespace,
  key: string,
  state: LockState,
): Promise<void> {
  const ttl = Math.max(3600, state.lockedUntil - nowSec() + 60);
  await kv
    .put(key, JSON.stringify(state), { expirationTtl: ttl })
    .catch(() => {});
}

export interface LoginGate {
  allowed: boolean;
  retryAfterSec: number;
}

export async function checkLoginAllowed(
  kv: KVNamespace,
  ip: string,
  emailNormalized: string,
): Promise<LoginGate> {
  const now = nowSec();
  const keys = [lockKey("ip", ip), lockKey("acct", emailNormalized)];
  let retryAfter = 0;
  for (const k of keys) {
    const st = await readState(kv, k);
    if (st.lockedUntil > now)
      retryAfter = Math.max(retryAfter, st.lockedUntil - now);
  }
  return retryAfter > 0
    ? { allowed: false, retryAfterSec: retryAfter }
    : { allowed: true, retryAfterSec: 0 };
}

export async function recordLoginFailure(
  kv: KVNamespace,
  ip: string,
  emailNormalized: string,
): Promise<void> {
  const now = nowSec();
  for (const k of [lockKey("ip", ip), lockKey("acct", emailNormalized)]) {
    const st = await readState(kv, k);
    st.failures += 1;
    if (st.failures % MAX_FAILURES_BEFORE_LOCK === 0) {
      const lockNumber = Math.floor(st.failures / MAX_FAILURES_BEFORE_LOCK);
      const duration = BASE_LOCK_SEC * 2 ** (lockNumber - 1);
      st.lockedUntil = now + duration;
    }
    await writeState(kv, k, st);
  }
}

export async function clearLoginAttempts(
  kv: KVNamespace,
  ip: string,
  emailNormalized: string,
): Promise<void> {
  await kv.delete(lockKey("ip", ip)).catch(() => {});
  await kv.delete(lockKey("acct", emailNormalized)).catch(() => {});
}
