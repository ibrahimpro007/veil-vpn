"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import {
  listAuditLogs,
  listNodes,
  listSubscriptions,
  listUsers,
} from "@/lib/adminApi";
import {
  Badge,
  EmptyState,
  PageHeader,
  SkeletonRows,
  useToast,
} from "@/components/ui";
import { fmtDateTime, timeAgo } from "@/lib/format";

interface Stats {
  totalUsers: number;
  activeSubs: number;
  nodesOnline: number;
  totalCapacity: number;
  nodes: Awaited<ReturnType<typeof listNodes>>["nodes"];
  recentAudit: Awaited<ReturnType<typeof listAuditLogs>>["data"];
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div className="card transition hover:border-zinc-700">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-zinc-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function OverviewPage() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, subs, nodesRes, audit] = await Promise.all([
        listUsers({ page: 1, pageSize: 1 }),
        listSubscriptions({ status: "active", page: 1, pageSize: 1 }),
        listNodes(),
        listAuditLogs({ page: 1, pageSize: 8 }),
      ]);
      const nodes = nodesRes.nodes;
      setStats({
        totalUsers: users.total,
        activeSubs: subs.total,
        nodesOnline: nodes.filter((n) => n.status === "active").length,
        totalCapacity: nodes.reduce((s, n) => s + n.capacity, 0),
        nodes,
        recentAudit: audit.data,
      });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load overview", err);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Fleet health and key figures at a glance."
        actions={
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {loading || !stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card">
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
              <div className="mt-3 h-9 w-16 animate-pulse rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total users"
              value={stats.totalUsers.toLocaleString()}
              href="/dashboard/users"
            />
            <StatCard
              label="Active subscriptions"
              value={stats.activeSubs.toLocaleString()}
              href="/dashboard/subscriptions"
            />
            <StatCard
              label="Nodes online"
              value={stats.nodesOnline}
              hint={`${stats.nodes.length} registered`}
              href="/dashboard/nodes"
            />
            <StatCard
              label="Total capacity"
              value={stats.totalCapacity.toLocaleString()}
              hint="configured peer slots"
            />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Node health
              </h2>
              {stats.nodes.length === 0 ? (
                <EmptyState
                  title="No nodes registered"
                  hint="Provision nodes with the bootstrap script, then register them on the Nodes page."
                />
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {stats.nodes.map((n) => {
                    const stale = Date.now() / 1000 - n.updatedAt > 10 * 60;
                    return (
                      <li
                        key={n.id}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {n.region} · {n.city}{" "}
                            <span className="text-zinc-500">
                              ({n.countryCode})
                            </span>
                          </p>
                          <p className="truncate font-mono text-xs text-zinc-500">
                            {n.endpoint} · seen {timeAgo(n.updatedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {n.status === "active" && stale && (
                            <span className="rounded-full border border-amber-700 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                              stale heartbeat
                            </span>
                          )}
                          <Badge value={n.status} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Recent admin activity
              </h2>
              {stats.recentAudit.length === 0 ? (
                <EmptyState title="No audit entries yet" />
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {stats.recentAudit.map((a) => (
                    <li key={a.id} className="py-2.5">
                      <p className="text-sm text-zinc-200">
                        <span className="font-mono text-cyan-300">
                          {a.action}
                        </span>{" "}
                        <span className="text-zinc-500">
                          {a.entity}
                          {a.entityId ? ` ${a.entityId.slice(0, 8)}` : ""}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {fmtDateTime(a.createdAt)}
                        {a.actorAdminId
                          ? ` · admin ${a.actorAdminId.slice(0, 8)}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/dashboard/audit-logs"
                className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300"
              >
                View all audit logs →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
