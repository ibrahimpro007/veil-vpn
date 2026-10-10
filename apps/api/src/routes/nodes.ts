import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import { listNodeRows } from "../db/queries.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { VpnNodePublic } from "@veil/shared";

/**
 * GET /v1/nodes — public node list. Exposes ONLY region/country/city/
 * endpoint/status/sortOrder. Load figures, capacity, peer counts, and IP
 * pool details are NEVER exposed (privacy invariant, PHASE1_NOTES.md).
 */
export function registerNodeRoutes(app: App): void {
  app.get("/v1/nodes", rateLimit("nodes-list", 60, 60), async (c) => {
    const db = makeDb(c.env.DB);
    const rows = await listNodeRows(db, ["active", "draining"]);
    const nodes: VpnNodePublic[] = rows.map((n) => ({
      id: n.id,
      region: n.region,
      countryCode: n.countryCode,
      city: n.city,
      endpoint: n.endpoint,
      status: n.status as VpnNodePublic["status"],
      sortOrder: n.sortOrder,
    }));
    return c.json({ nodes });
  });
}
