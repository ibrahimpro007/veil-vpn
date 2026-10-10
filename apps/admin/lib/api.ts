/**
 * Typed fetch wrapper for the VeilVPN Worker API (/admin/*).
 *
 * Auth model (documented tradeoff):
 * The admin session JWT lives in JS memory, with a sessionStorage fallback so
 * a page reload doesn't sign the admin out. It is sent as
 * `Authorization: Bearer <token>` on every request.
 *
 * Tradeoff vs an httpOnly cookie + Next.js /api proxy: an httpOnly cookie
 * would keep the token out of JS (immune to token theft via XSS), but it
 * requires proxying every API call through Next.js route handlers, adds
 * latency, and complicates Vercel/Worker deployments. This console ships
 * with strict CSP, HttpOnly-less storage is session-scoped (not persisted
 * across browser restarts), and every mutation requires an explicit admin
 * session issued by the Worker with TOTP. If the threat model later
 * demands it, swap `getToken()` for a cookie-backed proxy in `app/api/`
 * without changing any page code — only this module talks to the network.
 *
 * 401 handling: any 401 clears the session and redirects to /login
 * (preserving the current path in `?next=`). 403s surface as toasts with
 * the server's requestId for correlation.
 */

import type { ApiErrorBody } from "@veil/shared";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

if (!API_BASE && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.warn(
    "NEXT_PUBLIC_API_BASE_URL is not set — admin API calls will fail.",
  );
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/* ---------------- session token store ---------------- */

const TOKEN_KEY = "veil_admin_token";
const MARKER_COOKIE = "veil_admin_auth";

let memoryToken: string | null = null;

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  const stored = readStoredToken();
  if (stored) memoryToken = stored;
  return stored;
}

function setMarkerCookie(present: boolean) {
  if (typeof document === "undefined") return;
  if (present) {
    // Session-scoped marker so middleware can fast-redirect logged-out users.
    // NOT a security boundary (see module docstring).
    document.cookie = `${MARKER_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=28800`;
  } else {
    document.cookie = `${MARKER_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
  }
}

export function setToken(token: string | null) {
  memoryToken = token;
  if (typeof window !== "undefined") {
    try {
      if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable — memory-only session */
    }
    setMarkerCookie(!!token);
  }
}

export function clearSession() {
  setToken(null);
}

/* ---------------- 401 handling ---------------- */

let unauthorizedHandler: (() => void) | null = null;

/** Registered once by the AuthProvider. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

function handleUnauthorized() {
  clearSession();
  if (unauthorizedHandler) unauthorizedHandler();
  else if (typeof window !== "undefined") {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/login?next=${next}`;
  }
}

/* ---------------- admin JWT claims (display only) ---------------- */

export type AdminRole = "owner" | "support" | "read-only";

export interface AdminClaims {
  adminId: string;
  email: string;
  role: AdminRole;
  exp: number;
}

/**
 * Decode the admin session JWT payload for display (role badge, RBAC
 * gating). The signature is NOT verified here — the Worker verifies it on
 * every request; this is display-only data.
 */
/** base64url → UTF-8 string (browser-safe, no Node Buffer needed). */
function b64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeClaims(token: string): AdminClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(b64UrlDecode(parts[1])) as Record<
      string,
      unknown
    >;
    const role = payload.role;
    if (role !== "owner" && role !== "support" && role !== "read-only") {
      return null;
    }
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    if (exp * 1000 < Date.now()) return null;
    return {
      adminId: String(payload.sub ?? payload.adminId ?? ""),
      email: String(payload.email ?? ""),
      role,
      exp,
    };
  } catch {
    return null;
  }
}

/* ---------------- request core ---------------- */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Extra headers (merged over defaults). */
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }
  const suffix = qs.toString();
  return `${API_BASE}${path}${suffix ? `?${suffix}` : ""}`;
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return res.text();
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toApiError(
  status: number,
  data: unknown,
  res: Response,
  fallbackRequestId: string,
): ApiError {
  const body = data as ApiErrorBody | null;
  const requestId =
    body?.requestId ?? res.headers.get("x-request-id") ?? fallbackRequestId;
  return new ApiError(
    status,
    body?.error?.code ?? `http_${status}`,
    body?.error?.message ?? `Request failed with status ${status}`,
    requestId,
  );
}

export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(
      0,
      "config_error",
      "NEXT_PUBLIC_API_BASE_URL is not configured.",
      null,
    );
  }
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const token = getToken();
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Request-Id": requestId,
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw toApiError(res.status, await parseBody(res), res, requestId);
  }
  if (res.status === 204) return undefined as T;
  const data = await parseBody(res);
  if (!res.ok) throw toApiError(res.status, data, res, requestId);
  return data as T;
}

/** Raw response variant for non-JSON downloads (CSV export). */
export async function apiFetchRaw(
  path: string,
  opts: RequestOptions = {},
): Promise<Response> {
  if (!API_BASE) {
    throw new ApiError(
      0,
      "config_error",
      "NEXT_PUBLIC_API_BASE_URL is not configured.",
      null,
    );
  }
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const token = getToken();
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Request-Id": requestId,
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw toApiError(res.status, await parseBody(res), res, requestId);
  }
  if (!res.ok)
    throw toApiError(res.status, await parseBody(res), res, requestId);
  return res;
}

/** Download a file (e.g. users.csv) via an authenticated GET. */
export async function apiDownload(path: string, filename: string) {
  const res = await apiFetchRaw(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
