import { createMiddleware } from "hono/factory";
import { verifyJwtEdDSA } from "../util/crypto.js";
import { findAdminById } from "../db/queries.js";
import { makeDb } from "../db/index.js";
import { apiError } from "./errors.js";
import type { AdminSession } from "../app.js";
import { UserRole } from "@veil/shared";

export type AdminRole = "owner" | "support" | "read-only";

/**
 * Admin authentication: verifies the admin session JWT (typ "admin", 12h TTL)
 * and enforces RBAC. Role hierarchy: owner > support > read-only.
 * Pass the minimum roles allowed, e.g. requireAdmin(["owner"]) or
 * requireAdmin(["owner", "support"]).
 */
export function requireAdmin(allowedRoles: AdminRole[]) {
  return createMiddleware(async (c, next) => {
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
    if (!claims || claims.typ !== "admin") {
      return apiError(
        c,
        401,
        "unauthorized",
        "Invalid or expired admin session.",
      );
    }
    const db = makeDb(c.env.DB);
    const admin = await findAdminById(db, claims.sub);
    if (!admin || admin.status !== "active") {
      return apiError(c, 401, "unauthorized", "Admin account is not active.");
    }
    const role = admin.role as AdminRole;
    if (!allowedRoles.includes(role)) {
      return apiError(
        c,
        403,
        "forbidden",
        "Your admin role cannot perform this action.",
      );
    }
    const session: AdminSession = { id: admin.id, email: admin.email, role };
    c.set("admin", session);
    await next();
  });
}

export { UserRole };
