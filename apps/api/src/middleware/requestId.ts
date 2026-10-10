import { createMiddleware } from "hono/factory";

/**
 * Correlation: every request gets a UUID; it is echoed on every response
 * as X-Request-Id and embedded in every error body as requestId.
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});
