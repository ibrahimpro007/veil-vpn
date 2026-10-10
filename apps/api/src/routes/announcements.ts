import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import { listActiveAnnouncements } from "../db/queries.js";
import { nowSec } from "../util/crypto.js";
import type { Announcement } from "@veil/shared";

/** GET /v1/announcements — public, only within the active window. */
export function registerAnnouncementRoutes(app: App): void {
  app.get("/v1/announcements", async (c) => {
    const db = makeDb(c.env.DB);
    const rows = await listActiveAnnouncements(db, nowSec());
    const announcements: Announcement[] = rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      createdAt: a.createdAt,
    }));
    return c.json({ announcements });
  });
}
