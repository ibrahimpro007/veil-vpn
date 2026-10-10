"use client";

import { useCallback, useEffect, useState } from "react";
import { nodeRegisterSchema, type VpnNodeAdmin } from "@veil/shared";
import { ApiError } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { listNodes, registerNode, updateNode } from "@/lib/adminApi";
import {
  Badge,
  ConfirmModal,
  EmptyState,
  FieldError,
  Modal,
  PageHeader,
  SkeletonRows,
  Spinner,
  useToast,
} from "@/components/ui";
import { fmtDateTime, timeAgo } from "@/lib/format";

type NodeStatus = "active" | "draining" | "disabled";

function StatusModal({
  node,
  onClose,
  onDone,
}: {
  node: VpnNodeAdmin;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<NodeStatus>(node.status as NodeStatus);
  const [capacity, setCapacity] = useState(String(node.capacity));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 0) {
      setFormError("Capacity must be a non-negative integer.");
      return;
    }
    const patch: { status?: NodeStatus; capacity?: number } = {};
    if (status !== node.status) patch.status = status;
    if (cap !== node.capacity) patch.capacity = cap;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await updateNode(node.id, patch);
      toast.success("Node updated");
      onClose();
      onDone();
    } catch (err) {
      toast.error("Failed to update node", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Manage node ${node.region} · ${node.city}`}
    >
      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <label className="label" htmlFor="node-status">
            Status
          </label>
          <select
            id="node-status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as NodeStatus)}
          >
            <option value="active">active — takes new peers</option>
            <option value="draining">
              draining — no new peers, keeps existing
            </option>
            <option value="disabled">disabled — removed from rotation</option>
          </select>
        </div>
        <div className="mb-2">
          <label className="label" htmlFor="node-capacity">
            Capacity (peer slots)
          </label>
          <input
            id="node-capacity"
            type="number"
            min={0}
            className="input"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
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
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RegisterNodeModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    region: "",
    countryCode: "",
    city: "",
    endpoint: "",
    wgPublicKey: "",
    capacity: "500",
    ipPoolCidr: "",
    dnsIp: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = nodeRegisterSchema.safeParse({
      ...form,
      capacity: Number(form.capacity),
      sortOrder: 0,
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues
          .map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
          .join(" · "),
      );
      return;
    }
    setBusy(true);
    try {
      await registerNode(parsed.data);
      toast.success("Node registered");
      onClose();
      onDone();
    } catch (err) {
      toast.error("Failed to register node", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Register node" wide>
      <p className="mb-4 text-sm text-zinc-400">
        Nodes are provisioned by the bootstrap script; this form registers an
        already-provisioned node&apos;s endpoint and WireGuard public key with
        the control plane.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rn-region">
              Region
            </label>
            <input
              id="rn-region"
              className="input"
              value={form.region}
              onChange={set("region")}
              placeholder="eu-west"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rn-cc">
              Country code (2 letters)
            </label>
            <input
              id="rn-cc"
              className="input"
              value={form.countryCode}
              onChange={set("countryCode")}
              placeholder="DE"
              maxLength={2}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rn-city">
              City
            </label>
            <input
              id="rn-city"
              className="input"
              value={form.city}
              onChange={set("city")}
              placeholder="Frankfurt"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rn-endpoint">
              Endpoint (host:port)
            </label>
            <input
              id="rn-endpoint"
              className="input font-mono"
              value={form.endpoint}
              onChange={set("endpoint")}
              placeholder="vpn-eu1.example.com:51820"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="rn-pubkey">
              WireGuard public key (44-char base64)
            </label>
            <input
              id="rn-pubkey"
              className="input font-mono"
              value={form.wgPublicKey}
              onChange={set("wgPublicKey")}
              placeholder="…"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rn-capacity">
              Capacity
            </label>
            <input
              id="rn-capacity"
              type="number"
              min={1}
              className="input"
              value={form.capacity}
              onChange={set("capacity")}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rn-cidr">
              IP pool CIDR
            </label>
            <input
              id="rn-cidr"
              className="input font-mono"
              value={form.ipPoolCidr}
              onChange={set("ipPoolCidr")}
              placeholder="10.7.0.0/24"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="rn-dns">
              DNS IP (IPv4)
            </label>
            <input
              id="rn-dns"
              className="input font-mono"
              value={form.dnsIp}
              onChange={set("dnsIp")}
              placeholder="10.7.0.1"
              required
            />
          </div>
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
            Register node
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function NodesPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [nodes, setNodes] = useState<VpnNodeAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState<VpnNodeAdmin | null>(null);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNodes();
      setNodes(res.nodes);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load nodes", err);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = can(claims?.role, "nodes.manage");

  return (
    <div>
      <PageHeader
        title="Nodes"
        subtitle="WireGuard fleet: status, capacity, and registration. Load figures are never exposed to clients."
        actions={
          canManage ? (
            <button
              className="btn-primary"
              onClick={() => setRegistering(true)}
            >
              + Register node
            </button>
          ) : undefined
        }
      />

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="bg-zinc-900/80">
            <tr>
              <th className="th">Region / City</th>
              <th className="th">Endpoint</th>
              <th className="th">Status</th>
              <th className="th">Capacity</th>
              <th className="th">Last heartbeat</th>
              {canManage && <th className="th text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading || !nodes ? (
              <SkeletonRows rows={5} cols={canManage ? 6 : 5} />
            ) : nodes.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6">
                  <EmptyState
                    title="No nodes registered"
                    hint="Provision a node with the bootstrap script, then register it here."
                  />
                </td>
              </tr>
            ) : (
              nodes.map((n) => {
                const stale = Date.now() / 1000 - n.updatedAt > 10 * 60;
                return (
                  <tr
                    key={n.id}
                    className="border-t border-zinc-800 hover:bg-zinc-900/40"
                  >
                    <td className="td">
                      <span className="font-medium text-zinc-100">
                        {n.region}
                      </span>
                      <p className="text-xs text-zinc-500">
                        {n.city} ({n.countryCode})
                      </p>
                    </td>
                    <td className="td font-mono text-xs text-zinc-300">
                      {n.endpoint}
                    </td>
                    <td className="td">
                      <Badge value={n.status} />
                      {n.status === "active" && stale && (
                        <p className="mt-1 text-[11px] text-amber-400">
                          stale heartbeat
                        </p>
                      )}
                    </td>
                    <td className="td text-zinc-200">
                      {n.capacity.toLocaleString()}
                    </td>
                    <td
                      className="td text-zinc-400"
                      title={fmtDateTime(n.updatedAt)}
                    >
                      {timeAgo(n.updatedAt)}
                    </td>
                    {canManage && (
                      <td className="td text-right">
                        <button
                          className="btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => setManaging(n)}
                        >
                          Manage
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {managing && (
        <StatusModal
          node={managing}
          onClose={() => setManaging(null)}
          onDone={load}
        />
      )}
      {registering && (
        <RegisterNodeModal
          onClose={() => setRegistering(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
