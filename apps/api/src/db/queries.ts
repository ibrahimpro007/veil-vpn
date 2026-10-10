/**
 * Data-access layer. All SQL goes through here (Drizzle query builder);
 * route handlers never write raw SQL, except the single idempotent
 * payment_events insert which needs D1's `meta.changes` directly.
 */
import {
  eq,
  and,
  or,
  like,
  inArray,
  isNull,
  lt,
  lte,
  desc,
  asc,
  count,
  sql,
} from "drizzle-orm";
import type { Db } from "./index.js";
import {
  users,
  emailTokens,
  refreshTokens,
  devices,
  plans,
  subscriptions,
  paymentEvents,
  vpnNodes,
  peers,
  adminUsers,
  announcements,
  abuseFlags,
} from "./schema.js";
import { sha256Hex, newId, nowSec } from "../util/crypto.js";

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type VpnNodeRow = typeof vpnNodes.$inferSelect;
export type PeerRow = typeof peers.$inferSelect;
export type AdminUserRow = typeof adminUsers.$inferSelect;
export type AnnouncementRow = typeof announcements.$inferSelect;

const LIVE_STATUSES = ["trialing", "active", "past_due"] as const;

/* ---------------- users ---------------- */

export async function findUserByEmail(
  db: Db,
  email: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0];
}

export async function findUserById(
  db: Db,
  id: string,
): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string; name?: string | null },
): Promise<UserRow> {
  const now = nowSec();
  const row: NewUser = {
    id: newId(),
    email: input.email,
    passwordHash: input.passwordHash,
    name: input.name ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(users).values(row);
  return (await findUserById(db, row.id)) as UserRow;
}

export async function setUserStatus(
  db: Db,
  id: string,
  status: string,
): Promise<void> {
  await db
    .update(users)
    .set({ status, updatedAt: nowSec() })
    .where(eq(users.id, id));
}

export async function updateUserName(
  db: Db,
  id: string,
  name: string | null,
): Promise<void> {
  await db
    .update(users)
    .set({ name, updatedAt: nowSec() })
    .where(eq(users.id, id));
}

export async function setEmailVerified(
  db: Db,
  id: string,
  at: number,
): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: at, updatedAt: nowSec() })
    .where(eq(users.id, id));
}

export async function updateUserPassword(
  db: Db,
  id: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: nowSec() })
    .where(eq(users.id, id));
}

export async function deleteUser(db: Db, id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function searchUsers(
  db: Db,
  opts: { search: string; status?: string; page: number; pageSize: number },
): Promise<{ rows: UserRow[]; total: number }> {
  const conds = [];
  if (opts.search) conds.push(like(users.email, `%${opts.search}%`));
  if (opts.status) conds.push(eq(users.status, opts.status));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const totalRows = await db.select({ n: count() }).from(users).where(where);
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  return { rows, total: totalRows[0]?.n ?? 0 };
}

export async function listAllUsers(db: Db): Promise<UserRow[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

/* ---------------- email tokens ---------------- */

export const EMAIL_TOKEN_TTL_SEC = 30 * 60;

export async function createEmailToken(
  db: Db,
  userId: string,
  purpose: "verify" | "reset",
  ttlSec: number = EMAIL_TOKEN_TTL_SEC,
): Promise<{ token: string; expiresAt: number }> {
  // 32 random bytes, URL-safe. Only the sha256 hash is stored.
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  const token = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const now = nowSec();
  await db.insert(emailTokens).values({
    id: newId(),
    userId,
    tokenHash: await sha256Hex(token),
    purpose,
    expiresAt: now + ttlSec,
    createdAt: now,
  });
  return { token, expiresAt: now + ttlSec };
}

/** Single-use consume: returns the row only if valid, unexpired, unused — and marks it used. */
export async function consumeEmailToken(
  db: Db,
  token: string,
  purpose: "verify" | "reset",
): Promise<EmailTokenRow | null> {
  const hash = await sha256Hex(token);
  const rows = await db
    .select()
    .from(emailTokens)
    .where(eq(emailTokens.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.purpose !== purpose ||
    row.usedAt != null ||
    row.expiresAt <= nowSec()
  ) {
    return null;
  }
  await db
    .update(emailTokens)
    .set({ usedAt: nowSec() })
    .where(eq(emailTokens.id, row.id));
  return row;
}

/** Purge expired or already-used email tokens (hourly cron). */
export async function purgeEmailTokens(
  db: Db,
  now: number = nowSec(),
): Promise<number> {
  const res = await db
    .delete(emailTokens)
    .where(
      or(
        lte(emailTokens.expiresAt, now),
        sql`${emailTokens.usedAt} IS NOT NULL`,
      ),
    );
  return changesOf(res);
}

/* ---------------- refresh tokens ---------------- */

export async function storeRefreshToken(
  db: Db,
  input: {
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    deviceId?: string | null;
    expiresAt: number;
  },
): Promise<void> {
  await db.insert(refreshTokens).values({
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    familyId: input.familyId,
    deviceId: input.deviceId ?? null,
    expiresAt: input.expiresAt,
    createdAt: nowSec(),
  });
}

export async function findRefreshTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<RefreshTokenRow | undefined> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function revokeRefreshToken(
  db: Db,
  id: string,
  at: number = nowSec(),
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: at })
    .where(eq(refreshTokens.id, id));
}

/** Revoke every token in a family (reuse detection response / logout). */
export async function revokeFamily(
  db: Db,
  familyId: string,
  at: number = nowSec(),
): Promise<number> {
  const res = await db
    .update(refreshTokens)
    .set({ revokedAt: at })
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.revokedAt),
      ),
    );
  return changesOf(res);
}

export async function revokeAllUserRefreshTokens(
  db: Db,
  userId: string,
  at: number = nowSec(),
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: at })
    .where(
      and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
    );
}

/** Purge revoked tokens older than `cutoffSec` and long-expired tokens. */
export async function purgeRefreshTokens(
  db: Db,
  cutoffSec: number,
): Promise<number> {
  const res = await db
    .delete(refreshTokens)
    .where(
      or(
        lt(refreshTokens.revokedAt, cutoffSec),
        lt(refreshTokens.expiresAt, cutoffSec),
      ),
    );
  return changesOf(res);
}

/* ---------------- devices ---------------- */

export async function listDevicesByUser(
  db: Db,
  userId: string,
): Promise<DeviceRow[]> {
  return db
    .select()
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(asc(devices.createdAt));
}

export async function countDevicesByUser(
  db: Db,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(devices)
    .where(eq(devices.userId, userId));
  return rows[0]?.n ?? 0;
}

export async function findDeviceById(
  db: Db,
  id: string,
): Promise<DeviceRow | undefined> {
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.id, id))
    .limit(1);
  return rows[0];
}

export async function findDeviceByPubkey(
  db: Db,
  pubkey: string,
): Promise<DeviceRow | undefined> {
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.wgPublicKey, pubkey))
    .limit(1);
  return rows[0];
}

export async function createDevice(
  db: Db,
  input: {
    userId: string;
    name: string;
    platform: string;
    wgPublicKey: string;
  },
): Promise<DeviceRow> {
  const row = {
    id: newId(),
    userId: input.userId,
    name: input.name,
    platform: input.platform,
    wgPublicKey: input.wgPublicKey,
    createdAt: nowSec(),
  };
  await db.insert(devices).values(row);
  return (await findDeviceById(db, row.id)) as DeviceRow;
}

export async function deleteDevice(db: Db, id: string): Promise<void> {
  await db.delete(devices).where(eq(devices.id, id));
}

/** Day-granularity activity marker (YYYYMMDD). Never a precise timestamp. */
export async function touchDeviceDay(
  db: Db,
  id: string,
  yyyymmdd: number,
): Promise<void> {
  await db
    .update(devices)
    .set({ lastSeenCoarse: yyyymmdd })
    .where(eq(devices.id, id));
}

/* ---------------- plans ---------------- */

export async function getPlanById(
  db: Db,
  id: string,
): Promise<PlanRow | undefined> {
  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0];
}

export async function getPlanBySlug(
  db: Db,
  slug: string,
): Promise<PlanRow | undefined> {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, slug))
    .limit(1);
  return rows[0];
}

export async function listActivePlans(db: Db): Promise<PlanRow[]> {
  return db
    .select()
    .from(plans)
    .where(eq(plans.active, 1))
    .orderBy(asc(plans.priceCents));
}

export function planProductRefs(plan: PlanRow): Record<string, string> {
  try {
    return JSON.parse(plan.providerProductRefs) as Record<string, string>;
  } catch {
    return {};
  }
}

/* ---------------- subscriptions ---------------- */

export async function getLiveSubscriptionByUser(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...LIVE_STATUSES]),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function getSubscriptionById(
  db: Db,
  id: string,
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);
  return rows[0];
}

export async function getSubscriptionByProviderRef(
  db: Db,
  providerRef: string,
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerRef, providerRef))
    .limit(1);
  return rows[0];
}

export async function createSubscription(
  db: Db,
  input: {
    userId: string;
    planId: string;
    status: string;
    provider: string;
    providerRef?: string | null;
    providerCustomerId?: string | null;
    currentPeriodEnd?: number | null;
    graceUntil?: number | null;
  },
): Promise<SubscriptionRow> {
  const now = nowSec();
  const row = {
    id: newId(),
    userId: input.userId,
    planId: input.planId,
    status: input.status,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    provider: input.provider,
    providerRef: input.providerRef ?? null,
    providerCustomerId: input.providerCustomerId ?? null,
    graceUntil: input.graceUntil ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(subscriptions).values(row);
  return (await getSubscriptionById(db, row.id)) as SubscriptionRow;
}

export async function updateSubscription(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      SubscriptionRow,
      | "status"
      | "currentPeriodEnd"
      | "provider"
      | "providerRef"
      | "providerCustomerId"
      | "graceUntil"
      | "planId"
    >
  >,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ ...patch, updatedAt: nowSec() })
    .where(eq(subscriptions.id, id));
}

export async function listSubscriptions(
  db: Db,
  opts: { status?: string; page: number; pageSize: number },
): Promise<{ rows: SubscriptionRow[]; total: number }> {
  const where = opts.status ? eq(subscriptions.status, opts.status) : undefined;
  const totalRows = await db
    .select({ n: count() })
    .from(subscriptions)
    .where(where);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(where)
    .orderBy(desc(subscriptions.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  return { rows, total: totalRows[0]?.n ?? 0 };
}

/* ---------------- payment events ---------------- */

export interface PaymentEventInput {
  provider: string;
  providerEventId: string;
  type: string;
  userId?: string | null;
  subscriptionId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  rawHash: string;
}

/**
 * Idempotent insert: returns true when this event was recorded for the first
 * time, false when provider_event_id was already seen (caller must then
 * return 200 immediately without re-processing). Uses the raw D1 client so
 * we can read `meta.changes` from ON CONFLICT DO NOTHING.
 */
export async function insertPaymentEventOnce(
  d1: D1Database,
  evt: PaymentEventInput,
): Promise<boolean> {
  const now = nowSec();
  const res = await d1
    .prepare(
      `INSERT INTO payment_events (id, provider, provider_event_id, type, user_id, subscription_id, amount_cents, currency, raw_hash, processed_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(provider_event_id) DO NOTHING`,
    )
    .bind(
      newId(),
      evt.provider,
      evt.providerEventId,
      evt.type,
      evt.userId ?? null,
      evt.subscriptionId ?? null,
      evt.amountCents ?? null,
      evt.currency ?? null,
      evt.rawHash,
      now,
      now,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function listPaymentEvents(
  db: Db,
  opts: { provider?: string; page: number; pageSize: number },
): Promise<{ rows: PaymentEventRow[]; total: number }> {
  const where = opts.provider
    ? eq(paymentEvents.provider, opts.provider)
    : undefined;
  const totalRows = await db
    .select({ n: count() })
    .from(paymentEvents)
    .where(where);
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(where)
    .orderBy(desc(paymentEvents.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  return { rows, total: totalRows[0]?.n ?? 0 };
}

/* ---------------- nodes ---------------- */

export async function listNodeRows(
  db: Db,
  statuses?: string[],
): Promise<VpnNodeRow[]> {
  const where = statuses ? inArray(vpnNodes.status, statuses) : undefined;
  return db
    .select()
    .from(vpnNodes)
    .where(where)
    .orderBy(asc(vpnNodes.sortOrder), asc(vpnNodes.id));
}

export async function getNodeById(
  db: Db,
  id: string,
): Promise<VpnNodeRow | undefined> {
  const rows = await db
    .select()
    .from(vpnNodes)
    .where(eq(vpnNodes.id, id))
    .limit(1);
  return rows[0];
}

export async function updateNode(
  db: Db,
  id: string,
  patch: Partial<
    Pick<VpnNodeRow, "status" | "capacity" | "sortOrder" | "dnsIp">
  >,
): Promise<void> {
  await db
    .update(vpnNodes)
    .set({ ...patch, updatedAt: nowSec() })
    .where(eq(vpnNodes.id, id));
}

export interface NewNodeInput {
  region: string;
  countryCode: string;
  city: string;
  endpoint: string;
  wgPublicKey: string;
  capacity: number;
  ipPoolCidr: string;
  dnsIp: string;
  sortOrder: number;
}

/** Register an already-provisioned node. New nodes start `disabled` — an
 * owner must explicitly flip them to `active` via PATCH after verifying
 * the bootstrap output (TLS fingerprint, leak tests). */
export async function insertNode(
  db: Db,
  input: NewNodeInput,
): Promise<VpnNodeRow> {
  const now = nowSec();
  const row: VpnNodeRow = {
    id: newId(),
    status: "disabled",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  await db.insert(vpnNodes).values(row);
  return row;
}

/** Peer counts per node id (used for least-loaded selection). */
export async function countPeersPerNode(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ nodeId: peers.nodeId, n: count() })
    .from(peers)
    .groupBy(peers.nodeId);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.nodeId, r.n);
  return m;
}

/* ---------------- peers ---------------- */

export async function getPeerByDevice(
  db: Db,
  deviceId: string,
): Promise<PeerRow | undefined> {
  const rows = await db
    .select()
    .from(peers)
    .where(eq(peers.deviceId, deviceId))
    .limit(1);
  return rows[0];
}

export async function createPeer(
  db: Db,
  input: { deviceId: string; nodeId: string; assignedIp: string },
): Promise<PeerRow> {
  const row = {
    id: newId(),
    deviceId: input.deviceId,
    nodeId: input.nodeId,
    assignedIp: input.assignedIp,
    createdAt: nowSec(),
  };
  await db.insert(peers).values(row);
  return row;
}

export async function deletePeerByDevice(
  db: Db,
  deviceId: string,
): Promise<void> {
  await db.delete(peers).where(eq(peers.deviceId, deviceId));
}

export async function deletePeerById(db: Db, id: string): Promise<void> {
  await db.delete(peers).where(eq(peers.id, id));
}

export async function listUsedIpsByNode(
  db: Db,
  nodeId: string,
): Promise<string[]> {
  const rows = await db
    .select({ ip: peers.assignedIp })
    .from(peers)
    .where(eq(peers.nodeId, nodeId));
  return rows.map((r) => r.ip);
}

/**
 * Rows needed by the lapsed-peer cron: every current peer with its device,
 * node endpoint, and the device owner's live subscription (if any).
 * No connection history is stored anywhere — peers are current-state only.
 *
 * NOTE: this uses raw SQL (not the Drizzle builder) with explicit column
 * aliases: several joined tables share column names (id, status, ...), and
 * the query-builder's flat select mis-maps those. The aliases make the
 * mapping unambiguous.
 */
export interface PeerSweepRow {
  peerId: string;
  deviceId: string;
  devicePubkey: string;
  userId: string;
  nodeId: string;
  nodeEndpoint: string;
  subId: string | null;
  subStatus: string | null;
  subPeriodEnd: number | null;
  subGraceUntil: number | null;
  planSlug: string | null;
  planDeviceLimit: number | null;
}

export async function listPeersForSweep(
  d1: D1Database,
): Promise<PeerSweepRow[]> {
  const res = await d1
    .prepare(
      `SELECT p.id AS peer_id, p.device_id AS device_id, d.wg_public_key AS device_pubkey,
              d.user_id AS user_id, p.node_id AS node_id, n.endpoint AS node_endpoint,
              s.id AS sub_id, s.status AS sub_status, s.current_period_end AS sub_period_end,
              s.grace_until AS sub_grace_until, pl.slug AS plan_slug,
              pl.device_limit AS plan_device_limit
       FROM peers p
       JOIN devices d ON d.id = p.device_id
       JOIN vpn_nodes n ON n.id = p.node_id
       LEFT JOIN subscriptions s ON s.user_id = d.user_id AND s.status IN ('trialing','active','past_due')
       LEFT JOIN plans pl ON pl.id = s.plan_id`,
    )
    .all<Record<string, unknown>>();
  const rows = res.results ?? [];
  return rows.map((r) => ({
    peerId: String(r["peer_id"]),
    deviceId: String(r["device_id"]),
    devicePubkey: String(r["device_pubkey"]),
    userId: String(r["user_id"]),
    nodeId: String(r["node_id"]),
    nodeEndpoint: String(r["node_endpoint"]),
    subId: r["sub_id"] == null ? null : String(r["sub_id"]),
    subStatus: r["sub_status"] == null ? null : String(r["sub_status"]),
    subPeriodEnd:
      r["sub_period_end"] == null ? null : Number(r["sub_period_end"]),
    subGraceUntil:
      r["sub_grace_until"] == null ? null : Number(r["sub_grace_until"]),
    planSlug: r["plan_slug"] == null ? null : String(r["plan_slug"]),
    planDeviceLimit:
      r["plan_device_limit"] == null ? null : Number(r["plan_device_limit"]),
  }));
}

/* ---------------- admin users ---------------- */

export async function findAdminByEmail(
  db: Db,
  email: string,
): Promise<AdminUserRow | undefined> {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);
  return rows[0];
}

export async function findAdminById(
  db: Db,
  id: string,
): Promise<AdminUserRow | undefined> {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  return rows[0];
}

export async function createAdmin(
  db: Db,
  input: {
    email: string;
    passwordHash: string;
    role: string;
    totpSecretEncrypted: string;
  },
): Promise<AdminUserRow> {
  const now = nowSec();
  const row = {
    id: newId(),
    ...input,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(adminUsers).values(row);
  return (await findAdminById(db, row.id)) as AdminUserRow;
}

/* ---------------- announcements ---------------- */

export async function listActiveAnnouncements(
  db: Db,
  now: number,
): Promise<AnnouncementRow[]> {
  return db
    .select()
    .from(announcements)
    .where(
      and(
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
        or(isNull(announcements.endsAt), sql`${announcements.endsAt} > ${now}`),
      ),
    )
    .orderBy(desc(announcements.createdAt));
}

export async function listAllAnnouncements(db: Db): Promise<AnnouncementRow[]> {
  return db.select().from(announcements).orderBy(desc(announcements.createdAt));
}

export async function createAnnouncement(
  db: Db,
  input: {
    title: string;
    body: string;
    startsAt?: number | null;
    endsAt?: number | null;
    createdByAdminId?: string | null;
  },
): Promise<AnnouncementRow> {
  const row = {
    id: newId(),
    title: input.title,
    body: input.body,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    createdAt: nowSec(),
    createdByAdminId: input.createdByAdminId ?? null,
  };
  await db.insert(announcements).values(row);
  const rows = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, row.id))
    .limit(1);
  return rows[0] as AnnouncementRow;
}

export async function deleteAnnouncement(db: Db, id: string): Promise<boolean> {
  const res = await db.delete(announcements).where(eq(announcements.id, id));
  return changesOf(res) > 0;
}

/* ---------------- abuse flags ---------------- */

export async function addAbuseFlag(
  db: Db,
  userId: string,
  kind: string,
  reason?: string,
): Promise<void> {
  await db.insert(abuseFlags).values({
    id: newId(),
    userId,
    kind,
    reason: reason ?? null,
    createdAt: nowSec(),
  });
}

/* ---------------- helpers ---------------- */

function changesOf(res: unknown): number {
  const meta = (res as { meta?: { changes?: number } } | undefined)?.meta;
  if (typeof meta?.changes === "number") return meta.changes;
  // drizzle sqlite-core returns { changes } via .run() on some drivers
  const changes = (res as { changes?: number } | undefined)?.changes;
  return typeof changes === "number" ? changes : 0;
}
