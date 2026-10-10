import { createMiddleware } from "hono/factory";
import { corsOrigins } from "../env.js";

/**
 * Strict CORS: only origins in the APP_URL / ADMIN_URL / API_PUBLIC_URL
 * allowlist. No wildcard, no reflected origins, credentials never allowed.
 */
export const corsMiddleware = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = corsOrigins(c.env);
  const permitted = origin !== undefined && allowed.includes(origin);

  if (c.req.method === "OPTIONS") {
    if (!permitted) return c.body(null, 204);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin as string,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, X-Request-Id",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();
  if (permitted) {
    c.header("Access-Control-Allow-Origin", origin as string);
    c.header("Vary", "Origin");
  }
});
