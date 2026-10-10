"use client";

import { useState } from "react";
import { can, useAuth } from "@/lib/auth";
import { exportUsersCsv } from "@/lib/adminApi";
import { PageHeader, Spinner, useToast } from "@/components/ui";

export default function ExportPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const allowed = can(claims?.role, "export.users");

  async function onExport() {
    setBusy(true);
    try {
      await exportUsersCsv();
      toast.success("Export downloaded", "users.csv saved to your downloads.");
    } catch (err) {
      toast.error("Export failed", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Export"
        subtitle="Bulk data exports for compliance and analysis."
      />

      <div className="card max-w-xl">
        <h2 className="text-base font-semibold text-zinc-100">Users CSV</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Downloads every user record as CSV via{" "}
          <span className="font-mono text-xs">GET /admin/export/users.csv</span>
          . Owner role only — the API enforces this with a 403 for other roles,
          and the export itself is recorded in the audit log.
        </p>
        {!allowed && (
          <p className="mt-3 rounded-lg border border-amber-700 bg-amber-500/10 p-3 text-sm text-amber-200">
            Your role ({claims?.role}) cannot run exports. Ask an owner.
          </p>
        )}
        <button
          className="btn-primary mt-4"
          onClick={onExport}
          disabled={!allowed || busy}
          title={allowed ? "Download users.csv" : "Requires owner role"}
        >
          {busy && <Spinner small />}
          Download users.csv
        </button>
      </div>
    </div>
  );
}
