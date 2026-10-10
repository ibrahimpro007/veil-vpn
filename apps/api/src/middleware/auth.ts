import { createMiddleware } from "hono/factory";
import { verifyJwtEdDSA } from "../util/crypto.js";
import { findUserById } from "../db/queries.js";
import { makeDb } from "../db/index.js";
import { apiError } from "./errors.js";
import type { AuthUser } from "../app.js";

/**
 * User authentication: verifies the EdDSA access JWT and loads the account.
 * Suspended/banned users are rejected here (403) so no downstream handler
 * has to remember the check.
 */
export const requireUser = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return apiError(
      c,
      401,
      "unauthorized",
      "Missing or invalid authorization header.",
    );
  }
  const claims = await verifyJwtEdDSA(
    header.slice(7),
    c.env.JWT_EDDSA_PUBLIC_KEY,
  );
  if (!claims || claims.typ !== "access") {
    return apiError(c, 401, "unauthorized", "Invalid or expired access token.");
  }
  const db = makeDb(c.env.DB);
  const user = await findUserById(db, claims.sub);
  if (!user) {
    return apiError(c, 401, "unauthorized", "Account no longer exists.");
  }
  if (user.status === "suspended") {
    return apiError(
      c,
      403,
      "account_suspended",
      "This account has been suspended.",
    );
  }
  if (user.status === "banned" || user.status === "deleted") {
    return apiError(
      c,
      403,
      "account_banned",
      "This account is no longer active.",
    );
  }
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    status: user.status,
  };
  c.set("authUser", authUser);
  await next();
});
