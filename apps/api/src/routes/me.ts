import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import { findUserById, updateUserName } from "../db/queries.js";
import { requireUser } from "../middleware/auth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { updateProfileSchema, type UserProfile } from "@veil/shared";

function toProfile(u: {
  id: string;
  email: string;
  emailVerifiedAt: number | null;
  status: string;
  createdAt: number;
}): UserProfile {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt != null,
    status: u.status as UserProfile["status"],
    createdAt: u.createdAt,
  };
}

export function registerMeRoutes(app: App): void {
  app.get("/v1/me", requireUser, async (c) => {
    const db = makeDb(c.env.DB);
    const user = await findUserById(db, c.get("authUser")!.id);
    if (!user)
      return apiError(c, 401, "unauthorized", "Account no longer exists.");
    return c.json(toProfile(user));
  });

  app.patch(
    "/v1/me",
    requireUser,
    rateLimit("me-patch", 30, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = updateProfileSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const userId = c.get("authUser")!.id;
      await updateUserName(db, userId, parsed.data.name);
      const user = await findUserById(db, userId);
      if (!user)
        return apiError(c, 401, "unauthorized", "Account no longer exists.");
      return c.json(toProfile(user));
    },
  );
}
