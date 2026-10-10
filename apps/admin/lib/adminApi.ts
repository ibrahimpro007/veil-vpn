/**
 * Typed wrappers for every /admin/* route this console calls.
 *
 * Routes marked [spec] exist in packages/shared/src/openapi.yaml exactly as
 * called here. Routes marked [ext] are small, consistent extensions the
 * console needs that are NOT yet in the spec — same ApiError envelope,
 * same adminSession bearer scheme — see README "Spec deviations" and flag
 * them to the Worker (Phase 2) implementer.
 */

import { apiDownload, apiFetch } from "./api";
import type {
  Announcement,
  AuditLogEntry,
  Device,
  Paginated,
  PaymentEvent,
  Subscription,
  UserProfile,
  VpnNodeAdmin,
} from "@veil/shared";

/* ---------------- admin auth [ext] ---------------- */

export interface AdminLoginResponse {
  /** True when a TOTP code is required to complete sign-in. */
  totpRequired: boolean;
  /** Present when totpRequired is true; pass to totp-verify. */
  challengeId?: string;
  /** Present when no TOTP step is needed. */
  sessionToken?: string;
}

export interface AdminTotpVerifyResponse {
  sessionToken: string;
}

/**
 * Step 1: email + password.
 * [ext] POST /admin/auth/login — the OpenAPI spec does not define admin
 * auth routes yet; the Worker implements this per PHASE1_NOTES
 * ("session JWT on /admin/* (adminSession security scheme)", issued by the
 * admin login flow with TOTP).
 */
export function adminLogin(
  email: string,
  password: string,
): Promise<AdminLoginResponse> {
  return apiFetch<AdminLoginResponse>("/admin/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

/** Step 2: TOTP code against the login challenge. [ext] */
export function adminTotpVerify(
  challengeId: string,
  code: string,
): Promise<AdminTotpVerifyResponse> {
  return apiFetch<AdminTotpVerifyResponse>("/admin/auth/totp-verify", {
    method: "POST",
    body: { challengeId, code },
  });
}

/* ---------------- users [spec] ---------------- */

export function listUsers(params: {
  search?: string;
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<Paginated<UserProfile>> {
  return apiFetch<Paginated<UserProfile>>("/admin/users", { query: params });
}

export function suspendUser(id: string, reason: string) {
  return apiFetch<UserProfile>(
    `/admin/users/${encodeURIComponent(id)}/suspend`,
    {
      method: "POST",
      body: { reason },
    },
  );
}

/** [ext] Undo a suspension. Mirrors the suspend route's response shape. */
export function unsuspendUser(id: string) {
  return apiFetch<UserProfile>(
    `/admin/users/${encodeURIComponent(id)}/unsuspend`,
    { method: "POST" },
  );
}

export function banUser(id: string, reason: string) {
  return apiFetch<UserProfile>(`/admin/users/${encodeURIComponent(id)}/ban`, {
    method: "POST",
    body: { reason },
  });
}

/** [ext] Undo a ban. Mirrors the ban route's response shape. */
export function unbanUser(id: string) {
  return apiFetch<UserProfile>(`/admin/users/${encodeURIComponent(id)}/unban`, {
    method: "POST",
  });
}

/** [ext] Devices belonging to one user (for the user detail drawer). */
export function getUserDevices(userId: string): Promise<{ devices: Device[] }> {
  return apiFetch<{ devices: Device[] }>(
    `/admin/users/${encodeURIComponent(userId)}/devices`,
  );
}

/** [ext] Live subscription of one user (for the user detail drawer). */
export function getUserSubscription(
  userId: string,
): Promise<{ subscription: Subscription | null }> {
  return apiFetch<{ subscription: Subscription | null }>(
    `/admin/users/${encodeURIComponent(userId)}/subscription`,
  );
}

/** [ext] Payment events of one user (for the user detail drawer). */
export function getUserPaymentEvents(
  userId: string,
  pageSize = 5,
): Promise<Paginated<PaymentEvent>> {
  return apiFetch<Paginated<PaymentEvent>>(
    `/admin/users/${encodeURIComponent(userId)}/payment-events`,
    { query: { page: 1, pageSize } },
  );
}

/* ---------------- devices [spec] ---------------- */

export function revokeDevice(id: string, reason?: string): Promise<void> {
  return apiFetch<void>(`/admin/devices/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

/* ---------------- grants [spec] ---------------- */

export function createGrant(input: {
  userId: string;
  planId: string;
  days: number;
  reason: string;
}): Promise<Subscription> {
  return apiFetch<Subscription>("/admin/grants", {
    method: "POST",
    body: input,
  });
}

/* ---------------- subscriptions [spec] ---------------- */

export function listSubscriptions(params: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<Subscription>> {
  return apiFetch<Paginated<Subscription>>("/admin/subscriptions", {
    query: params,
  });
}

/* ---------------- payment events [spec] ---------------- */

export function listPaymentEvents(params: {
  provider?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<PaymentEvent>> {
  return apiFetch<Paginated<PaymentEvent>>("/admin/payment-events", {
    query: params,
  });
}

/* ---------------- nodes ---------------- */

export function listNodes(): Promise<{ nodes: VpnNodeAdmin[] }> {
  return apiFetch<{ nodes: VpnNodeAdmin[] }>("/admin/nodes");
}

/** [spec] PATCH /admin/nodes/:id — owner only. */
export function updateNode(
  id: string,
  patch: {
    status?: "active" | "draining" | "disabled";
    capacity?: number;
    sortOrder?: number;
    dnsIp?: string;
  },
): Promise<VpnNodeAdmin> {
  return apiFetch<VpnNodeAdmin>(`/admin/nodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * [ext] POST /admin/nodes — register an already-provisioned node
 * (endpoint + WireGuard public key) with the control plane.
 * Body validated client-side with nodeRegisterSchema from @veil/shared.
 */
export function registerNode(input: {
  region: string;
  countryCode: string;
  city: string;
  endpoint: string;
  wgPublicKey: string;
  capacity: number;
  ipPoolCidr: string;
  dnsIp: string;
  sortOrder?: number;
}): Promise<VpnNodeAdmin> {
  return apiFetch<VpnNodeAdmin>("/admin/nodes", {
    method: "POST",
    body: input,
  });
}

/* ---------------- announcements ---------------- */

/** [ext] GET /admin/announcements — full list incl. scheduled/expired. */
export function listAnnouncements(): Promise<{
  announcements: Announcement[];
}> {
  return apiFetch<{ announcements: Announcement[] }>("/admin/announcements");
}

/** [spec] POST /admin/announcements — owner/support. */
export function createAnnouncement(input: {
  title: string;
  body: string;
  startsAt?: number;
  endsAt?: number;
}): Promise<Announcement> {
  return apiFetch<Announcement>("/admin/announcements", {
    method: "POST",
    body: input,
  });
}

/** [ext] DELETE /admin/announcements/:id — owner only. */
export function deleteAnnouncement(id: string): Promise<void> {
  return apiFetch<void>(`/admin/announcements/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/* ---------------- audit logs [spec] ---------------- */

export function listAuditLogs(params: {
  action?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<AuditLogEntry>> {
  return apiFetch<Paginated<AuditLogEntry>>("/admin/audit-logs", {
    query: params,
  });
}

export interface AuditVerifyResult {
  valid: boolean;
  checked: number;
  brokenAtId: number | null;
}

export function verifyAuditLogs(): Promise<AuditVerifyResult> {
  return apiFetch<AuditVerifyResult>("/admin/audit-logs/verify");
}

/* ---------------- export [spec] ---------------- */

export function exportUsersCsv(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  return apiDownload("/admin/export/users.csv", `veil-users-${stamp}.csv`);
}
