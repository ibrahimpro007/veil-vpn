import type { Context } from "hono";
import type { Env } from "../env.js";
import type { Vars } from "../app.js";

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

/** Standard ApiError envelope: { error: { code, message }, requestId }. */
export function apiError(
  c: Ctx,
  status: number,
  code: string,
  message: string,
): Response {
  const requestId = c.get("requestId") ?? "unknown";
  return c.json({ error: { code, message }, requestId }, status as never);
}

/** Zod validation failure → 400 validation_error with the first issue. */
export function validationError(
  c: Ctx,
  issues: { message: string }[],
): Response {
  const message = issues[0]?.message ?? "Invalid request";
  return apiError(c, 400, "validation_error", message);
}
