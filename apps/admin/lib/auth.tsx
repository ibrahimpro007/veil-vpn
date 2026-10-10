"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  decodeClaims,
  getToken,
  setToken,
  setUnauthorizedHandler,
  type AdminClaims,
  type AdminRole,
} from "./api";
import { adminLogin, adminTotpVerify } from "./adminApi";

export type { AdminRole };

interface AuthState {
  token: string | null;
  claims: AdminClaims | null;
  loading: boolean;
  /** Step 1 of login. Returns a TOTP challenge when the account needs it. */
  login: (
    email: string,
    password: string,
  ) => Promise<{ totpRequired: boolean; challengeId: string | null }>;
  /** Step 2 of login: verify the TOTP code against the challenge. */
  verifyTotp: (challengeId: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session (memory + sessionStorage fallback) on first load, and
  // route all future 401s back to /login.
  useEffect(() => {
    const existing = getToken();
    setTokenState(existing && decodeClaims(existing) ? existing : null);
    if (existing && !decodeClaims(existing)) setToken(null);
    setUnauthorizedHandler(() => {
      setTokenState(null);
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      router.replace(`/login?next=${next}`);
    });
    setLoading(false);
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const applyToken = useCallback((t: string) => {
    setToken(t);
    setTokenState(t);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await adminLogin(email, password);
      if (res.totpRequired) {
        return { totpRequired: true, challengeId: res.challengeId ?? null };
      }
      if (!res.sessionToken) {
        throw new Error("Login response missing session token.");
      }
      applyToken(res.sessionToken);
      return { totpRequired: false, challengeId: null };
    },
    [applyToken],
  );

  const verifyTotp = useCallback(
    async (challengeId: string, code: string) => {
      const res = await adminTotpVerify(challengeId, code);
      if (!res.sessionToken) {
        throw new Error("TOTP verification response missing session token.");
      }
      applyToken(res.sessionToken);
    },
    [applyToken],
  );

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    router.replace("/login");
  }, [router]);

  const claims = useMemo(() => (token ? decodeClaims(token) : null), [token]);

  const value = useMemo(
    () => ({ token, claims, loading, login, verifyTotp, logout }),
    [token, claims, loading, login, verifyTotp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/* ---------------- RBAC ---------------- */

/**
 * Client-side RBAC. The server is the authority (it returns 403 for
 * under-privileged calls); this map only controls which actions the UI
 * offers, so read-only admins never see buttons they can't use.
 */
export type AdminAction =
  | "users.view"
  | "users.suspend"
  | "users.unsuspend"
  | "users.ban"
  | "users.unban"
  | "devices.revoke"
  | "grants.create"
  | "nodes.manage"
  | "announcements.create"
  | "announcements.delete"
  | "audit.verify"
  | "export.users";

const ACTION_ROLES: Record<AdminAction, AdminRole[]> = {
  "users.view": ["owner", "support", "read-only"],
  "users.suspend": ["owner", "support"],
  "users.unsuspend": ["owner", "support"],
  "users.ban": ["owner"],
  "users.unban": ["owner"],
  "devices.revoke": ["owner", "support"],
  "grants.create": ["owner", "support"],
  "nodes.manage": ["owner"],
  "announcements.create": ["owner", "support"],
  "announcements.delete": ["owner"],
  "audit.verify": ["owner", "support"],
  "export.users": ["owner"],
};

export function can(
  role: AdminRole | null | undefined,
  action: AdminAction,
): boolean {
  if (!role) return false;
  return ACTION_ROLES[action].includes(role);
}
