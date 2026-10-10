"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentEvent } from "@veil/shared";
import { ApiError } from "@/lib/api";
import {
  EmptyState,
  PageHeader,
  Pagination,
  SkeletonRows,
  useToast,
} from "@/components/ui";
import { fmtDateTime, fmtMoney, shortId } from "@/lib/format";
import { listPaymentEvents } from "@/lib/adminApi";

/**
 * Refund deep links per provider, built from the event's providerEventId
 * (the provider's own payment/order identifier recorded on the event).
 *
 * - Stripe: dashboard.stripe.com/payments/<id> opens the payment detail
 *   page (works for pi_* / ch_* ids; evt_* ids identify webhook events).
 * - Lemon Squeezy: no stable per-order deep-link format is documented, so
 *   we open the orders list — search the event id there to find the order.
 * - Play / App Store / comp: refunds happen in the Play Console /
 *   App Store Connect / internal tooling; no deep link is available.
 */
function refundUrl(ev: PaymentEvent): string | null {
  if (ev.provider === "stripe") {
    return `https://dashboard.stripe.com/payments/${encodeURIComponent(ev.providerEventId)}`;
  }
  if (ev.provider === "lemonsqueezy") {
    return "https://app.lemonsqueezy.com/orders";
  }
  return null;
}

const PROVIDERS = ["stripe", "lemonsqueezy", "play", "storekit", "comp"];

export default function PaymentsPage() {
  const toast = useToast();
  const [provider, setProvider] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    data: PaymentEvent[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPaymentEvents({
        provider: provider || undefined,
        page,
        pageSize: 25,
      });
      setData({ data: res.data, total: res.total });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load payment events", err);
      }
    } finally {
      setLoading(false);
    }
  }, [provider, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [provider]);

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Webhook-derived payment events. Only payload hashes are stored — raw payloads are never kept (no-logs)."
      />

      <div className="mb-4">
        <select
          className="input w-48"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label="Filter by provider"
        >
          <option value="">All providers</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="bg-zinc-900/80">
            <tr>
              <th className="th">Event</th>
              <th className="th">Provider</th>
              <th className="th">Type</th>
              <th className="th">Amount</th>
              <th className="th">Processed</th>
              <th className="th text-right">Refund</th>
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              <SkeletonRows rows={8} cols={6} />
            ) : data.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6">
                  <EmptyState title="No payment events found" />
                </td>
              </tr>
            ) : (
              data.data.map((ev) => {
                const url = refundUrl(ev);
                return (
                  <tr
                    key={ev.id}
                    className="border-t border-zinc-800 hover:bg-zinc-900/40"
                  >
                    <td className="td">
                      <p className="font-mono text-xs text-zinc-300">
                        {shortId(ev.providerEventId, 20)}
                      </p>
                      <p
                        className="font-mono text-[11px] text-zinc-600"
                        title={ev.payloadHash}
                      >
                        hash {shortId(ev.payloadHash, 12)}
                      </p>
                    </td>
                    <td className="td text-zinc-400">{ev.provider}</td>
                    <td className="td text-zinc-300">{ev.type}</td>
                    <td className="td text-zinc-200">
                      {fmtMoney(ev.amountCents, ev.currency)}
                    </td>
                    <td className="td text-zinc-400">
                      {fmtDateTime(ev.processedAt ?? ev.createdAt)}
                    </td>
                    <td className="td text-right">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-ghost px-3 py-1.5 text-xs"
                          title={
                            ev.provider === "lemonsqueezy"
                              ? "Opens Lemon Squeezy orders — search the event id to refund"
                              : "Opens this payment in the Stripe dashboard to issue a refund"
                          }
                        >
                          Refund ↗
                        </a>
                      ) : (
                        <span
                          className="cursor-help text-xs text-zinc-600"
                          title="Refunds for this provider are issued in its own console (Play Console / App Store Connect / internal tooling)"
                        >
                          provider console
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
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
