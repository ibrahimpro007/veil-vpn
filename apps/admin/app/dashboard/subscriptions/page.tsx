"use client";

import { useCallback, useEffect, useState } from "react";
import type { Subscription } from "@veil/shared";
import { adminGrantSchema } from "@veil/shared";
import { ApiError } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { createGrant, listSubscriptions } from "@/lib/adminApi";
import {
  Badge,
  EmptyState,
  FieldError,
  Modal,
  PageHeader,
  Pagination,
  SkeletonRows,
  Spinner,
  useToast,
} from "@/components/ui";
import { fmtDateTime, shortId } from "@/lib/format";

/** Seeded plans (infra/d1/seed.sql) offered in the grant dialog. */
const KNOWN_PLANS = [
  { id: "plan_free_trial", label: "Veil Trial (free)" },
  { id: "plan_monthly", label: "Veil Monthly ($4.99/mo)" },
  { id: "plan_yearly", label: "Veil Yearly ($49.99/yr)" },
];

function GrantModal({
  open,
  onClose,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  onGranted: () => void;
}) {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("plan_monthly");
  const [customPlan, setCustomPlan] = useState(false);
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = adminGrantSchema.safeParse({
      userId: userId.trim(),
      planId: planId.trim(),
      days: Number(days),
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setBusy(true);
    try {
      await createGrant(parsed.data);
      toast.success("Complimentary access granted");
      onClose();
      onGranted();
      setUserId("");
      setReason("");
    } catch (err) {
      toast.error("Grant failed", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Grant complimentary access">
      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <label className="label" htmlFor="grant-user">
            User ID
          </label>
          <input
            id="grant-user"
            className="input font-mono"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Paste the user's ID (see Users → View)"
            required
          />
        </div>
        <div className="mb-4">
          <label className="label" htmlFor="grant-plan">
            Plan
          </label>
          {!customPlan ? (
            <select
              id="grant-plan"
              className="input"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {KNOWN_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input font-mono"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="plan id"
            />
          )}
          <button
            type="button"
            className="mt-1 text-xs text-cyan-400 hover:text-cyan-300"
            onClick={() => {
              setCustomPlan(!customPlan);
              setPlanId("plan_monthly");
            }}
          >
            {customPlan ? "Use known plans" : "Use a custom plan id"}
          </button>
        </div>
        <div className="mb-4">
          <label className="label" htmlFor="grant-days">
            Days (1–3650)
          </label>
          <input
            id="grant-days"
            type="number"
            min={1}
            max={3650}
            className="input"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </div>
        <div className="mb-2">
          <label className="label" htmlFor="grant-reason">
            Reason (required, recorded in audit log)
          </label>
          <textarea
            id="grant-reason"
            className="input min-h-[80px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="e.g. Goodwill extension after outage"
            required
          />
        </div>
        <FieldError message={formError ?? undefined} />
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner small />}
            Grant access
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SubscriptionsPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    data: Subscription[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [grantOpen, setGrantOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSubscriptions({
        status: status || undefined,
        page,
        pageSize: 25,
      });
      setData({ data: res.data, total: res.total });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load subscriptions", err);
      }
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        subtitle="Live, trialing, past-due, and historical subscriptions."
        actions={
          can(claims?.role, "grants.create") ? (
            <button className="btn-primary" onClick={() => setGrantOpen(true)}>
              + Grant complimentary
            </button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <select
          className="input w-48"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="bg-zinc-900/80">
            <tr>
              <th className="th">Subscription</th>
              <th className="th">Plan</th>
              <th className="th">Status</th>
              <th className="th">Provider</th>
              <th className="th">Period ends</th>
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              <SkeletonRows rows={8} cols={5} />
            ) : data.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6">
                  <EmptyState title="No subscriptions found" />
                </td>
              </tr>
            ) : (
              data.data.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/40"
                >
                  <td className="td font-mono text-xs text-zinc-300">
                    {shortId(s.id, 16)}
                  </td>
                  <td className="td">
                    <span className="font-medium">{s.planSlug}</span>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {s.planId}
                    </p>
                  </td>
                  <td className="td">
                    <Badge value={s.status} />
                  </td>
                  <td className="td text-zinc-400">{s.provider}</td>
                  <td className="td text-zinc-400">
                    {fmtDateTime(s.currentPeriodEnd)}
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

      <GrantModal
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        onGranted={load}
      />
    </div>
  );
}
