/**
 * Hash-chained, append-only audit log.
 * Every admin mutation appends a row; hash = sha256_hex(prev_hash +
 * canonical_json(entry)). GET /admin/audit-logs/verify recomputes the whole
 * chain. detail carries ids and action metadata only — never PII.
 */
import { desc, asc } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { sha256Hex, timingSafeEqual, nowSec } from "../util/crypto.js";

export interface AuditEntry {
  actorAdminId?: string | null;
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** JSON string of ids/action metadata only — never PII. */
  detail?: string | null;
}

const GENESIS = "GENESIS";

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

interface ChainFields {
  prevHash: string;
  actorAdminId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  createdAt: number;
}

function chainFields(
  prevHash: string,
  entry: AuditEntry,
  createdAt: number,
): ChainFields {
  return {
    prevHash,
    actorAdminId: entry.actorAdminId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? null,
    createdAt,
  };
}

export async function appendAudit(db: Db, entry: AuditEntry): Promise<void> {
  const last = await db
    .select({ hash: auditLogs.hash })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1);
  const prevHash = last[0]?.hash ?? GENESIS;
  const createdAt = nowSec();
  const fields = chainFields(prevHash, entry, createdAt);
  const hash = await sha256Hex(prevHash + canonicalJson(fields));
  await db.insert(auditLogs).values({ ...fields, hash });
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtId: number | null;
}

/** Recompute every link; return the first broken id, if any. */
export async function verifyAuditChain(db: Db): Promise<ChainVerification> {
  const rows = await db.select().from(auditLogs).orderBy(asc(auditLogs.id));
  let prevHash = GENESIS;
  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      return { valid: false, checked: rows.length, brokenAtId: row.id };
    }
    const fields = chainFields(
      row.prevHash,
      {
        actorAdminId: row.actorAdminId,
        actorUserId: row.actorUserId,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        detail: row.detail,
      },
      row.createdAt,
    );
    const recomputed = await sha256Hex(row.prevHash + canonicalJson(fields));
    if (!timingSafeEqual(recomputed, row.hash)) {
      return { valid: false, checked: rows.length, brokenAtId: row.id };
    }
    prevHash = row.hash;
  }
  return { valid: true, checked: rows.length, brokenAtId: null };
}
