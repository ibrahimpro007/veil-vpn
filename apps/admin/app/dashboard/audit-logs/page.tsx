"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditLogEntry } from "@veil/shared";
import { ApiError } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import {
  listAuditLogs,
  verifyAuditLogs,
  type AuditVerifyResult,
} from "@/lib/adminApi";
import {
  EmptyState,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonRows,
  Spinner,
  useDebouncedValue,
  useToast,
} from "@/components/ui";
import { fmtDateTime, shortId } from "@/lib/format";

export default function AuditLogsPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    data: AuditLogEntry[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(
    null,
  );

  const debouncedAction = useDebouncedValue(action);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAuditLogs({
        action: debouncedAction || undefined,
        page,
        pageSize: 25,
      });
      setData({ data: res.data, total: res.total });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load audit logs", err);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedAction, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedAction]);

  async function onVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await verifyAuditLogs();
      setVerifyResult(res);
      if (res.valid) {
        toast.success(
          "Audit chain verified",
          `${res.checked} entries checked, no breaks found.`,
        );
      } else {
        toast.error(
          "Audit chain BROKEN",
          `Hash mismatch at entry id ${res.brokenAtId}. Investigate immediately.`,
        );
      }
    } catch (err) {
      toast.error("Chain verification failed", err);
    } finally {
      setVerifying(false);
    }
  }

  const canVerify = can(claims?.role, "audit.verify");

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="Hash-chained, append-only record of admin actions. Details carry ids only, never PII."
        actions={
          canVerify ? (
            <button
              className="btn-primary"
              onClick={onVerify}
              disabled={verifying}
            >
              {verifying && <Spinner small />}
              Verify chain
            </button>
          ) : undefined
        }
      />

      {verifyResult && (
        <div
          className={`mb-4 rounded-xl border p-4 ${
            verifyResult.valid
              ? "border-emerald-700 bg-emerald-950/60"
              : "border-red-700 bg-red-950/60"
          }`}
          role="alert"
        >
          {verifyResult.valid ? (
            <p className="text-sm text-emerald-200">
              ✅ Chain intact — {verifyResult.checked} entries verified, no
              breaks detected.
            </p>
          ) : (
            <p className="text-sm font-semibold text-red-200">
              ⛔ Chain BROKEN at entry id {verifyResult.brokenAtId} (
              {verifyResult.checked} entries checked). Treat the log as
              compromised and investigate before trusting recent entries.
            </p>
          )}
        </div>
      )}

      <div className="mb-4 max-w-sm">
        <SearchInput
          value={action}
          onChange={setAction}
          placeholder="Filter by action, e.g. user.suspend…"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="bg-zinc-900/80">
            <tr>
              <th className="th">ID</th>
              <th className="th">Time</th>
              <th className="th">Actor</th>
              <th className="th">Action</th>
              <th className="th">Entity</th>
              <th className="th">Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              <SkeletonRows rows={8} cols={6} />
            ) : data.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6">
                  <EmptyState title="No audit entries found" />
                </td>
              </tr>
            ) : (
              data.data.map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/40"
                >
                  <td className="td font-mono text-xs text-zinc-400">{a.id}</td>
                  <td className="td whitespace-nowrap text-zinc-400">
                    {fmtDateTime(a.createdAt)}
                  </td>
                  <td className="td font-mono text-xs text-zinc-400">
                    {a.actorAdminId
                      ? `admin ${shortId(a.actorAdminId, 8)}`
                      : a.actorUserId
                        ? `user ${shortId(a.actorUserId, 8)}`
                        : "system"}
                  </td>
                  <td className="td font-mono text-xs text-cyan-300">
                    {a.action}
                  </td>
                  <td className="td text-zinc-300">
                    {a.entity}
                    {a.entityId && (
                      <span className="ml-1 font-mono text-[11px] text-zinc-500">
                        {shortId(a.entityId, 12)}
                      </span>
                    )}
                  </td>
                  <td
                    className="td max-w-64 truncate font-mono text-[11px] text-zinc-500"
                    title={a.detail ?? ""}
                  >
                    {a.detail ?? "—"}
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
    </div>
  );
}
