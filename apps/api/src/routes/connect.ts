import { connectRequestSchema, disconnectRequestSchema } from "@veil/shared";
import type { WireGuardPeerConfig } from "@veil/shared";
import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import {
  findDeviceById,
  getLiveSubscriptionByUser,
  getPlanById,
  listNodeRows,
  getNodeById,
  countPeersPerNode,
  listUsedIpsByNode,
  getPeerByDevice,
  createPeer,
  deletePeerByDevice,
  touchDeviceDay,
} from "../db/queries.js";
import { computeEntitlement } from "../entitlement.js";
import { nodeAddPeer, nodeRemovePeer } from "../nodeClient.js";
import { allocateIp } from "../util/ip.js";
import { nowSec } from "../util/crypto.js";
import { requireUser } from "../middleware/auth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rateLimit.js";

/** YYYYMMDD day-granularity marker (privacy: no precise timestamps). */
function dayStamp(now: number): number {
  const d = new Date(now * 1000);
  return (
    d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  );
}

function toConfig(
  assignedIp: string,
  node: {
    id: string;
    ipPoolCidr: string;
    wgPublicKey: string;
    endpoint: string;
    dnsIp: string;
    countryCode: string;
    city: string;
    region: string;
  },
  periodEnd: number | null,
): WireGuardPeerConfig {
  return {
    address: assignedIp,
    subnet: node.ipPoolCidr,
    serverPublicKey: node.wgPublicKey,
    endpoint: node.endpoint,
    dns: node.dnsIp,
    allowedIps: ["0.0.0.0/0"],
    node: {
      id: node.id,
      countryCode: node.countryCode,
      city: node.city,
      region: node.region,
    },
    // The config is valid while the subscription is; the lapsed-peer cron
    // removes peers whose entitlement ended.
    expiresAt: periodEnd ?? nowSec() + 86400,
  };
}

export function registerConnectRoutes(app: App): void {
  /**
   * POST /v1/connect — entitlement is resolved server-side from the
   * subscriptions table; client flags are never trusted.
   */
  app.post(
    "/v1/connect",
    requireUser,
    rateLimit("connect", 30, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = connectRequestSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = c.get("authUser")!;

      // (a) entitlement, server-side only
      const sub = await getLiveSubscriptionByUser(db, user.id);
      const plan = sub ? await getPlanById(db, sub.planId) : null;
      const ent = computeEntitlement(
        user.id,
        sub ?? null,
        plan ?? null,
        nowSec(),
      );
      if (!ent.canConnect) {
        return apiError(
          c,
          402,
          "payment_required",
          "No active subscription. Add a plan to connect.",
        );
      }

      // (b) the device must belong to the caller
      const device = await findDeviceById(db, parsed.data.deviceId);
      if (!device || device.userId !== user.id) {
        return apiError(c, 404, "not_found", "Device not found.");
      }

      // Idempotent: an existing peer just gets its config back.
      const existingPeer = await getPeerByDevice(db, device.id);
      if (existingPeer) {
        const node = await getNodeById(db, existingPeer.nodeId);
        if (node && node.status !== "disabled") {
          await touchDeviceDay(db, device.id, dayStamp(nowSec()));
          return c.json(
            toConfig(
              existingPeer.assignedIp,
              node,
              sub?.currentPeriodEnd ?? null,
            ),
          );
        }
        // Stale peer on a dead node — drop it and continue to fresh allocation.
        await deletePeerByDevice(db, device.id);
      }

      // (c) node selection: requested node (must be active), else least-loaded
      //     active node by peers/capacity. Draining nodes take no new peers.
      let node;
      if (parsed.data.nodeId) {
        node = await getNodeById(db, parsed.data.nodeId);
        if (!node || node.status !== "active") {
          return apiError(
            c,
            404,
            "not_found",
            "Requested node is not available.",
          );
        }
      } else {
        const active = await listNodeRows(db, ["active"]);
        if (active.length === 0) {
          return apiError(
            c,
            503,
            "no_nodes",
            "No VPN nodes are available right now.",
          );
        }
        const counts = await countPeersPerNode(db);
        const scored = active
          .map((n) => ({
            n,
            load: (counts.get(n.id) ?? 0) / Math.max(1, n.capacity),
          }))
          .sort(
            (a, b) =>
              a.load - b.load ||
              a.n.sortOrder - b.n.sortOrder ||
              (a.n.id < b.n.id ? -1 : 1),
          );
        node = scored[0].n;
      }

      // (d) IP allocation. D1 has no interactive transactions, so allocation is
      //     "read used IPs → pick first free → INSERT"; the UNIQUE(node_id,
      //     assigned_ip) constraint plus a retry loop closes the race window.
      let assignedIp: string | null = null;
      let peerId: string | null = null;
      for (let attempt = 0; attempt < 3 && peerId === null; attempt++) {
        const used = await listUsedIpsByNode(db, node.id);
        // The node's DNS resolver address is never handed to a peer.
        assignedIp = allocateIp(node.ipPoolCidr, [...used, node.dnsIp]);
        if (!assignedIp) {
          return apiError(
            c,
            503,
            "node_full",
            "This node is at capacity. Try another region.",
          );
        }
        try {
          const peer = await createPeer(db, {
            deviceId: device.id,
            nodeId: node.id,
            assignedIp,
          });
          peerId = peer.id;
        } catch {
          // UNIQUE violation under concurrency → recompute and retry.
          peerId = null;
        }
      }
      if (!peerId || !assignedIp) {
        return apiError(
          c,
          503,
          "node_full",
          "Could not allocate an address. Try again.",
        );
      }

      // (f) register the peer with the node agent (HMAC-signed, retried once).
      //     On failure the DB row is rolled back and the client gets a 502.
      const added = await nodeAddPeer(
        c.env,
        { endpoint: node.endpoint },
        device.wgPublicKey,
        assignedIp,
        node.dnsIp,
      );
      if (!added) {
        await deletePeerByDevice(db, device.id);
        return apiError(
          c,
          502,
          "node_unreachable",
          "The VPN node did not accept the peer. Try again.",
        );
      }

      await touchDeviceDay(db, device.id, dayStamp(nowSec()));
      return c.json(toConfig(assignedIp, node, sub?.currentPeriodEnd ?? null));
    },
  );

  /** POST /v1/disconnect — best-effort peer removal. Always 204. */
  app.post("/v1/disconnect", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = disconnectRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const user = c.get("authUser")!;
    const device = await findDeviceById(db, parsed.data.deviceId);
    if (device && device.userId === user.id) {
      const peer = await getPeerByDevice(db, device.id);
      if (peer) {
        const node = await getNodeById(db, peer.nodeId);
        if (node) {
          await nodeRemovePeer(
            c.env,
            { endpoint: node.endpoint },
            device.wgPublicKey,
          );
        }
        await deletePeerByDevice(db, device.id);
      }
    }
    return c.body(null, 204);
  });
}
