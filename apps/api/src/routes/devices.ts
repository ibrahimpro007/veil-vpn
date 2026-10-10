import { deviceRegisterSchema, deviceIdParamSchema } from "@veil/shared";
import type { App, AuthUser } from "../app.js";
import { makeDb } from "../db/index.js";
import {
  listDevicesByUser,
  countDevicesByUser,
  findDeviceById,
  findDeviceByPubkey,
  createDevice,
  deleteDevice,
  getLiveSubscriptionByUser,
  getPlanById,
  getPeerByDevice,
  deletePeerByDevice,
  getNodeById,
} from "../db/queries.js";
import { computeEntitlement } from "../entitlement.js";
import { nodeRemovePeer } from "../nodeClient.js";
import { requireUser } from "../middleware/auth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { nowSec } from "../util/crypto.js";
import type { Device } from "@veil/shared";

function toDevice(d: {
  id: string;
  name: string;
  platform: string;
  wgPublicKey: string;
  lastSeenCoarse: number | null;
  createdAt: number;
}): Device {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform as Device["platform"],
    wgPublicKey: d.wgPublicKey,
    lastSeenDay: d.lastSeenCoarse,
    createdAt: d.createdAt,
  };
}

/** Device cap: the live plan's device_limit, hard-capped at 5 (no plan: 5). */
async function deviceLimitFor(
  db: ReturnType<typeof makeDb>,
  user: AuthUser,
): Promise<number> {
  const sub = await getLiveSubscriptionByUser(db, user.id);
  if (!sub) return 5;
  const plan = await getPlanById(db, sub.planId);
  if (!plan) return 5;
  const ent = computeEntitlement(user.id, sub, plan, nowSec());
  return Math.min(ent.deviceLimit || 5, 5);
}

export function registerDeviceRoutes(app: App): void {
  app.get("/v1/devices", requireUser, async (c) => {
    const db = makeDb(c.env.DB);
    const rows = await listDevicesByUser(db, c.get("authUser")!.id);
    return c.json({ devices: rows.map(toDevice) });
  });

  app.post(
    "/v1/devices",
    requireUser,
    rateLimit("devices-create", 30, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = deviceRegisterSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = c.get("authUser")!;

      // The server only ever receives the public key; the private key is
      // generated and kept on the client device.
      const dupe = await findDeviceByPubkey(db, parsed.data.wgPublicKey);
      if (dupe) {
        return apiError(
          c,
          409,
          "device_exists",
          "A device with this WireGuard key is already registered.",
        );
      }
      const limit = await deviceLimitFor(db, user);
      const used = await countDevicesByUser(db, user.id);
      if (used >= limit) {
        return apiError(
          c,
          403,
          "device_limit_reached",
          `Device limit reached (${limit}). Remove a device first.`,
        );
      }
      const device = await createDevice(db, {
        userId: user.id,
        name: parsed.data.name,
        platform: parsed.data.platform,
        wgPublicKey: parsed.data.wgPublicKey,
      });
      return c.json(toDevice(device), 201);
    },
  );

  /**
   * DELETE /v1/devices/:id — also asks the node agent to drop the peer
   * (HMAC-signed). If the node is unreachable the DB row is still deleted
   * and the 15-minute reconciliation cron heals the agent side.
   */
  app.delete("/v1/devices/:id", requireUser, async (c) => {
    const parsed = deviceIdParamSchema.safeParse({ id: c.req.param("id") });
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const user = c.get("authUser")!;
    const device = await findDeviceById(db, parsed.data.id);
    if (!device || device.userId !== user.id) {
      return apiError(c, 404, "not_found", "Device not found.");
    }
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
    await deleteDevice(db, device.id);
    return c.body(null, 204);
  });
}
