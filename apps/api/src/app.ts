import type { Hono } from "hono";
import type { Env } from "./env.js";

export interface AuthUser {
  id: string;
  email: string;
  status: string;
}

export interface AdminSession {
  id: string;
  email: string;
  role: "owner" | "support" | "read-only";
}

export interface Vars {
  requestId: string;
  authUser?: AuthUser;
  admin?: AdminSession;
}

export type App = Hono<{ Bindings: Env; Variables: Vars }>;
