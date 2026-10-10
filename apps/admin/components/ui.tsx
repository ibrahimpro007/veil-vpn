"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError } from "@/lib/api";

/* ================= toasts ================= */

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
  requestId?: string | null;
}

const ToastContext = createContext<{
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, err?: unknown) => void;
} | null>(null);

let toastSeq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = toastSeq++;
      setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
      window.setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );

  const success = useCallback(
    (title: string, detail?: string) =>
      push({ kind: "success", title, detail }),
    [push],
  );

  const error = useCallback(
    (title: string, err?: unknown) => {
      let detail: string | undefined;
      let requestId: string | null | undefined;
      if (err instanceof ApiError) {
        detail = err.message;
        requestId = err.requestId;
      } else if (err instanceof Error) {
        detail = err.message;
      }
      push({ kind: "error", title, detail, requestId });
    },
    [push],
  );

  const value = useMemo(
    () => ({ toasts, push, dismiss, success, error }),
    [toasts, push, dismiss, success, error],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border p-4 shadow-lg ${
              t.kind === "success"
                ? "border-emerald-700 bg-emerald-950/95"
                : t.kind === "error"
                  ? "border-red-700 bg-red-950/95"
                  : "border-zinc-700 bg-zinc-900/95"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${
                    t.kind === "success"
                      ? "text-emerald-200"
                      : t.kind === "error"
                        ? "text-red-200"
                        : "text-zinc-100"
                  }`}
                >
                  {t.title}
                </p>
                {t.detail && (
                  <p className="mt-1 break-words text-xs text-zinc-300">
                    {t.detail}
                  </p>
                )}
                {t.requestId && (
                  <p className="mt-1 font-mono text-[11px] text-zinc-400">
                    requestId: {t.requestId}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/* ================= modal ================= */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  requireReason,
  reason,
  setReason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  requireReason?: boolean;
  reason?: string;
  setReason?: (v: string) => void;
}) {
  const reasonOk = !requireReason || (reason?.trim().length ?? 0) > 0;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-zinc-300">{message}</p>
      {requireReason && setReason && (
        <div className="mt-4">
          <label className="label" htmlFor="confirm-reason">
            Reason (required, recorded in audit log)
          </label>
          <textarea
            id="confirm-reason"
            className="input min-h-[80px]"
            value={reason ?? ""}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this action being taken?"
            maxLength={500}
          />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy || !reasonOk}
        >
          {busy ? <Spinner small /> : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ================= drawer ================= */

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 p-5">
          <h2 className="truncate text-lg font-semibold text-zinc-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/* ================= small primitives ================= */

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-zinc-600 border-t-current ${
        small ? "h-4 w-4" : "h-8 w-8"
      }`}
      aria-label="Loading"
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-700",
  trialing: "bg-sky-500/15 text-sky-300 border-sky-700",
  past_due: "bg-amber-500/15 text-amber-300 border-amber-700",
  canceled: "bg-zinc-500/15 text-zinc-300 border-zinc-600",
  expired: "bg-zinc-500/15 text-zinc-400 border-zinc-700",
  suspended: "bg-amber-500/15 text-amber-300 border-amber-700",
  banned: "bg-red-500/15 text-red-300 border-red-700",
  deleted: "bg-zinc-500/15 text-zinc-500 border-zinc-700",
  draining: "bg-amber-500/15 text-amber-300 border-amber-700",
  disabled: "bg-red-500/15 text-red-300 border-red-700",
  owner: "bg-violet-500/15 text-violet-300 border-violet-700",
  support: "bg-cyan-500/15 text-cyan-300 border-cyan-700",
  "read-only": "bg-zinc-500/15 text-zinc-300 border-zinc-600",
};

export function Badge({ value }: { value: string }) {
  const style =
    BADGE_STYLES[value] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-600";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-700 px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function SkeletonRows({
  rows = 5,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-zinc-800">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-zinc-400">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ← Prev
        </button>
        <span className="px-2 py-1.5 text-xs">
          Page {page} of {pages}
        </span>
        <button
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        className="input pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        aria-label="Search"
      />
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        aria-hidden
      >
        ⌕
      </span>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

/** Debounce a string value (e.g. search input → API query). */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);
  return debounced;
}
