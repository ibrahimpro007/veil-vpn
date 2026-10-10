"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Device,
  PaymentEvent,
  Subscription,
  UserProfile,
} from "@veil/shared";
import { adminUserSuspendSchema } from "@veil/shared";
import { ApiError } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import {
  banUser,
  getUserDevices,
  getUserPaymentEvents,
  getUserSubscription,
  listUsers,
  revokeDevice,
  suspendUser,
  unbanUser,
  unsuspendUser,
} from "@/lib/adminApi";
import {
  Badge,
  ConfirmModal,
  Drawer,
  EmptyState,
  FieldError,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonRows,
  Spinner,
  useDebouncedValue,
  useToast,
} from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtSeenDay, shortId } from "@/lib/format";

type ActionKind = "suspend" | "unsuspend" | "ban" | "unban";
type PendingAction = { kind: ActionKind; user: UserProfile } | null;

function UserDrawer({
  user,
  onClose,
  onChanged,
}: {
  user: UserProfile;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { claims } = useAuth();
  const toast = useToast();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [subscription, setSubscription] = useState<
    Subscription | null | undefined
  >(undefined);
  const [payments, setPayments] = useState<PaymentEvent[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDevices(null);
    setSubscription(undefined);
    setPayments(null);
    Promise.all([
      getUserDevices(user.id).catch((e) => {
        toast.error("Failed to load devices", e);
        return { devices: [] as Device[] };
      }),
      getUserSubscription(user.id).catch((e) => {
        toast.error("Failed to load subscription", e);
        return { subscription: null as Subscription | null };
      }),
      getUserPaymentEvents(user.id).catch((e) => {
        toast.error("Failed to load payment events", e);
        return { data: [] as PaymentEvent[] };
      }),
    ]).then(([d, s, p]) => {
      if (!alive) return;
      setDevices(d.devices);
      setSubscription(s.subscription);
      setPayments(p.data);
    });
    return () => {
      alive = false;
    };
  }, [user.id, toast]);

  async function onRevoke(deviceId: string) {
    if (!can(claims?.role, "devices.revoke")) {
      toast.error("Not permitted", "Your role cannot revoke devices.");
      return;
    }
    setRevoking(deviceId);
    try {
      await revokeDevice(deviceId);
      toast.success("Device revoked");
      setDevices((prev) => prev?.filter((d) => d.id !== deviceId) ?? prev);
      onChanged();
    } catch (err) {
      toast.error("Failed to revoke device", err);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Drawer open onClose={onClose} title={user.email}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Account
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-zinc-500">Status</dt>
              <dd className="mt-0.5">
                <Badge value={user.status} />
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Email verified</dt>
              <dd className="mt-0.5 text-zinc-200">
                {user.emailVerified ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">User ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-zinc-300">
                {user.id}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Created</dt>
              <dd className="mt-0.5 text-zinc-200">
                {fmtDateTime(user.createdAt)}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Subscription
          </h3>
          {subscription === undefined ? (
            <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
          ) : subscription === null ? (
            <p className="text-sm text-zinc-500">No live subscription.</p>
          ) : (
            <div className="rounded-lg border border-zinc-800 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-100">
                  {subscription.planSlug}
                </span>
                <Badge value={subscription.status} />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Provider: {subscription.provider} · Period ends:{" "}
                {fmtDateTime(subscription.currentPeriodEnd)}
              </p>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Devices ({devices?.length ?? "…"})
          </h3>
          {devices === null ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-zinc-800/60"
                />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-zinc-500">No devices registered.</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {d.name}{" "}
                      <span className="text-zinc-500">· {d.platform}</span>
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {shortId(d.id, 12)} · last seen{" "}
                      {fmtSeenDay(d.lastSeenDay)}
                    </p>
                  </div>
                  {can(claims?.role, "devices.revoke") && (
                    <button
                      className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
                      disabled={revoking === d.id}
                      onClick={() => onRevoke(d.id)}
                    >
                      {revoking === d.id ? <Spinner small /> : "Revoke"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Recent payment events
          </h3>
          {payments === null ? (
            <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
          ) : payments.length === 0 ? (
            <p className="text-sm text-zinc-500">No payment events.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3"
                >
                  <div>
                    <p className="text-zinc-200">
                      {p.type}{" "}
                      <span className="text-zinc-500">· {p.provider}</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {fmtDateTime(p.processedAt ?? p.createdAt)}
                    </p>
                  </div>
                  <span className="text-sm text-zinc-200">
                    {fmtMoney(p.amountCents, p.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

export default function UsersPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    data: UserProfile[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawerUser, setDrawerUser] = useState<UserProfile | null>(null);

  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUsers({
        search: debouncedSearch,
        page,
        pageSize: 25,
        status: status || undefined,
      });
      setData({ data: res.data, total: res.total });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load users", err);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, status, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  function startAction(kind: ActionKind, user: UserProfile) {
    setReason("");
    setReasonError(null);
    setPending({ kind, user });
  }

  async function confirmAction() {
    if (!pending) return;
    const needsReason = pending.kind === "suspend" || pending.kind === "ban";
    if (needsReason) {
      const parsed = adminUserSuspendSchema.safeParse({ reason });
      if (!parsed.success) {
        setReasonError(
          parsed.error.issues[0]?.message ?? "A reason is required.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      const { kind, user } = pending;
      const trimmed = reason.trim();
      if (kind === "suspend") await suspendUser(user.id, trimmed);
      else if (kind === "ban") await banUser(user.id, trimmed);
      else if (kind === "unsuspend") await unsuspendUser(user.id);
      else await unbanUser(user.id);
      toast.success(
        `User ${kind === "suspend" ? "suspended" : kind === "unsuspend" ? "unsuspended" : kind === "ban" ? "banned" : "unbanned"}`,
      );
      setPending(null);
      if (drawerUser?.id === user.id) setDrawerUser(null);
      await load();
    } catch (err) {
      toast.error("Action failed", err);
    } finally {
      setBusy(false);
    }
  }

  const role = claims?.role;
  const canSuspend = can(role, "users.suspend");
  const canBan = can(role, "users.ban");

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Search, inspect, and moderate accounts."
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-64 flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by email…"
          />
        </div>
        <select
          className="input w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="bg-zinc-900/80">
            <tr>
              <th className="th">Email</th>
              <th className="th">Status</th>
              <th className="th">Verified</th>
              <th className="th">Created</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              <SkeletonRows rows={8} cols={5} />
            ) : data.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6">
                  <EmptyState
                    title="No users found"
                    hint="Try a different search or status filter."
                  />
                </td>
              </tr>
            ) : (
              data.data.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/40"
                >
                  <td className="td">
                    <button
                      className="text-left font-medium text-cyan-300 hover:underline"
                      onClick={() => setDrawerUser(u)}
                    >
                      {u.email}
                    </button>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {shortId(u.id, 12)}
                    </p>
                  </td>
                  <td className="td">
                    <Badge value={u.status} />
                  </td>
                  <td className="td">{u.emailVerified ? "Yes" : "No"}</td>
                  <td className="td text-zinc-400">
                    {fmtDateTime(u.createdAt)}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => setDrawerUser(u)}
                      >
                        View
                      </button>
                      {u.status === "suspended" ? (
                        <button
                          className="btn-ghost px-3 py-1.5 text-xs"
                          disabled={!canSuspend}
                          title={
                            canSuspend
                              ? "Unsuspend"
                              : "Requires support or owner role"
                          }
                          onClick={() => startAction("unsuspend", u)}
                        >
                          Unsuspend
                        </button>
                      ) : u.status !== "banned" && u.status !== "deleted" ? (
                        <button
                          className="btn-ghost px-3 py-1.5 text-xs"
                          disabled={!canSuspend}
                          title={
                            canSuspend
                              ? "Suspend"
                              : "Requires support or owner role"
                          }
                          onClick={() => startAction("suspend", u)}
                        >
                          Suspend
                        </button>
                      ) : null}
                      {u.status === "banned" ? (
                        <button
                          className="btn-ghost px-3 py-1.5 text-xs"
                          disabled={!canBan}
                          title={canBan ? "Unban" : "Requires owner role"}
                          onClick={() => startAction("unban", u)}
                        >
                          Unban
                        </button>
                      ) : u.status !== "deleted" ? (
                        <button
                          className="btn-danger px-3 py-1.5 text-xs"
                          disabled={!canBan}
                          title={canBan ? "Ban" : "Requires owner role"}
                          onClick={() => startAction("ban", u)}
                        >
                          Ban
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <Pagination
          page={page}
          pageSize={25}
          total={data.total}
          onPage={setPage}
        />
      )}

      {drawerUser && (
        <UserDrawer
          user={drawerUser}
          onClose={() => setDrawerUser(null)}
          onChanged={load}
        />
      )}

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        title={
          pending
            ? `${pending.kind === "suspend" ? "Suspend" : pending.kind === "unsuspend" ? "Unsuspend" : pending.kind === "ban" ? "Ban" : "Unban"} ${pending.user.email}`
            : ""
        }
        message={
          pending
            ? pending.kind === "suspend"
              ? "The user will be unable to sign in or connect until unsuspended."
              : pending.kind === "ban"
                ? "Banning is severe and owner-only. The account is permanently barred."
                : pending.kind === "unsuspend"
                  ? "The user will regain full access."
                  : "The user will regain full access."
            : ""
        }
        confirmLabel={
          pending
            ? pending.kind === "suspend"
              ? "Suspend user"
              : pending.kind === "unsuspend"
                ? "Unsuspend user"
                : pending.kind === "ban"
                  ? "Ban user"
                  : "Unban user"
            : "Confirm"
        }
        danger={pending?.kind === "suspend" || pending?.kind === "ban"}
        busy={busy}
        onConfirm={confirmAction}
        requireReason={pending?.kind === "suspend" || pending?.kind === "ban"}
        reason={reason}
        setReason={(v) => {
          setReason(v);
          setReasonError(null);
        }}
      />
      {reasonError && (
        <div className="fixed bottom-24 right-4 z-[60] w-96 max-w-[calc(100vw-2rem)]">
          <FieldError message={reasonError} />
        </div>
      )}
    </div>
  );
}
