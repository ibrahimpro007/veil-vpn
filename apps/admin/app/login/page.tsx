"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginSchema } from "@veil/shared";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { FieldError, Spinner, useToast } from "@/components/ui";

function LoginForm() {
  const { login, verifyTotp, token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const nextPath = searchParams.get("next") || "/dashboard";

  async function finish() {
    router.replace(nextPath.startsWith("/") ? nextPath : "/dashboard");
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setBusy(true);
    try {
      const res = await login(parsed.data.email, parsed.data.password);
      if (res.totpRequired) {
        if (!res.challengeId) {
          setFormError("Server requested TOTP but sent no challenge.");
          return;
        }
        setChallengeId(res.challengeId);
        setStep("totp");
      } else {
        toast.success("Signed in", "Welcome back to the VeilVPN console.");
        await finish();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setFormError("Too many attempts. Please wait and try again.");
      } else {
        setFormError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onTotp(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!/^\d{6,8}$/.test(code.trim())) {
      setFormError("Enter the 6–8 digit code from your authenticator app.");
      return;
    }
    if (!challengeId) {
      setFormError("Missing TOTP challenge. Please sign in again.");
      return;
    }
    setBusy(true);
    try {
      await verifyTotp(challengeId, code.trim());
      toast.success("Signed in", "Two-factor verification passed.");
      await finish();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Code verification failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Already signed in (e.g. back button): bounce to dashboard.
  if (token) {
    finish();
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-600/20 text-2xl">
            🛡️
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            VeilVPN Admin
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {step === "credentials"
              ? "Sign in with your admin account"
              : "Two-factor verification"}
          </p>
        </div>

        <div className="card">
          {step === "credentials" ? (
            <form onSubmit={onCredentials} noValidate>
              <div className="mb-4">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
              </div>
              <FieldError message={formError ?? undefined} />
              <button
                type="submit"
                className="btn-primary mt-4 w-full"
                disabled={busy}
              >
                {busy && <Spinner small />}
                Continue
              </button>
            </form>
          ) : (
            <form onSubmit={onTotp} noValidate>
              <p className="mb-4 text-sm text-zinc-400">
                Enter the code from your authenticator app for{" "}
                <span className="font-medium text-zinc-200">{email}</span>.
              </p>
              <div className="mb-4">
                <label className="label" htmlFor="totp">
                  Authenticator code
                </label>
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input text-center font-mono text-lg tracking-[0.5em]"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <FieldError message={formError ?? undefined} />
              <button
                type="submit"
                className="btn-primary mt-4 w-full"
                disabled={busy}
              >
                {busy && <Spinner small />}
                Verify & sign in
              </button>
              <button
                type="button"
                className="btn-ghost mt-2 w-full"
                onClick={() => {
                  setStep("credentials");
                  setCode("");
                  setFormError(null);
                }}
              >
                Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          First owner account? It is created by the Worker bootstrap script —
          see the admin README. TOTP is enrolled during that step.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
