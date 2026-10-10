import type { App } from "../app.js";

/** GET /v1/health — public liveness probe (also used by the smoke test). */
export function registerHealthRoutes(app: App): void {
  app.get("/v1/health", (c) => {
    return c.json({
      ok: true,
      service: "veil-api",
      time: Math.floor(Date.now() / 1000),
    });
  });
}
