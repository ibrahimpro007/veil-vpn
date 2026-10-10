/**
 * VeilVPN API — Cloudflare Worker entry point.
 *
 * Routes:
 *   Public:            GET  /v1/health, /v1/nodes, /v1/announcements
 *                      POST /v1/auth/*, /v1/webhooks/*
 *   User (Bearer JWT): /v1/me, /v1/devices/*, /v1/connect, /v1/disconnect,
 *                      /v1/subscription, /v1/billing/*, /v1/gdpr/*
 *   Admin (admin JWT + RBAC): /admin/auth/*, /admin/*
 *
 * Crons (infra/wrangler.toml):
 *   every 15 min → revoke peers of lapsed subscriptions
 *   hourly       → purge expired tokens; subscription lifecycle sweep
 */
import { Hono } from "hono";
import type { Env } from "./env.js";
import type { Vars } from "./app.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { securityHeadersMiddleware } from "./middleware/security.js";
import { corsMiddleware } from "./middleware/cors.js";
import { apiError } from "./middleware/errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerNodeRoutes } from "./routes/nodes.js";
import { registerConnectRoutes } from "./routes/connect.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerAnnouncementRoutes } from "./routes/announcements.js";
import { registerGdprRoutes } from "./routes/gdpr.js";
import { registerAdminRoutes } from "./admin/routes.js";
import {
  cronRevokeLapsed,
  cronPurgeTokens,
  cronSubscriptionLifecycle,
} from "./cron.js";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", requestIdMiddleware);
app.use("*", securityHeadersMiddleware);
app.use("*", corsMiddleware);

app.onError((err, c) => {
  console.error(`request ${c.get("requestId")} failed:`, err);
  return apiError(c, 500, "server_error", "Something went wrong. Try again.");
});

app.notFound((c) => apiError(c, 404, "not_found", "Not found."));

registerHealthRoutes(app);
registerAuthRoutes(app);
registerAnnouncementRoutes(app);
registerNodeRoutes(app);
registerMeRoutes(app);
registerDeviceRoutes(app);
registerConnectRoutes(app);
registerBillingRoutes(app);
registerWebhookRoutes(app);
registerGdprRoutes(app);
registerAdminRoutes(app);

export default {
  fetch: app.fetch,
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (event.cron === "*/15 * * * *") {
      const res = await cronRevokeLapsed(env);
      console.log(
        `cron revoke-lapsed: checked=${res.checked} removed=${res.peersRemoved}`,
      );
    } else if (event.cron === "0 * * * *") {
      const purged = await cronPurgeTokens(env);
      const life = await cronSubscriptionLifecycle(env);
      console.log(
        `cron hourly: purged email_tokens=${purged.emailTokens} refresh_tokens=${purged.refreshTokens} ` +
          `lifecycle=${JSON.stringify(life)}`,
      );
    }
  },
};
