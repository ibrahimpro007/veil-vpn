"use client";

import { useCallback, useEffect, useState } from "react";
import { announcementCreateSchema, type Announcement } from "@veil/shared";
import { ApiError } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from "@/lib/adminApi";
import {
  ConfirmModal,
  EmptyState,
  FieldError,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from "@/components/ui";
import { datetimeLocalToEpoch, fmtDateTime } from "@/lib/format";

function isLive(a: Announcement): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (a.startsAt && a.startsAt > now) return false;
  if (a.endsAt && a.endsAt < now) return false;
  return true;
}

function CreateModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const s = datetimeLocalToEpoch(startsAt);
    const en = datetimeLocalToEpoch(endsAt);
    if (s && en && en <= s) {
      setFormError("End time must be after start time.");
      return;
    }
    const parsed = announcementCreateSchema.safeParse({
      title: title.trim(),
      body: body.trim(),
      ...(s ? { startsAt: s } : {}),
      ...(en ? { endsAt: en } : {}),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setBusy(true);
    try {
      await createAnnouncement(parsed.data);
      toast.success("Announcement created");
      onClose();
      onDone();
    } catch (err) {
      toast.error("Failed to create announcement", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New announcement" wide>
      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <label className="label" htmlFor="ann-title">
            Title
          </label>
          <input
            id="ann-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div className="mb-4">
          <label className="label" htmlFor="ann-body">
            Body
          </label>
          <textarea
            id="ann-body"
            className="input min-h-[140px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            required
          />
        </div>
        <div className="mb-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ann-start">
              Starts at (optional)
            </label>
            <input
              id="ann-start"
              type="datetime-local"
              className="input"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="ann-end">
              Ends at (optional)
            </label>
            <input
              id="ann-end"
              type="datetime-local"
              className="input"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>
        <FieldError message={formError ?? undefined} />
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner small />}
            Publish
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function AnnouncementsPage() {
  const { claims } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAnnouncements();
      setItems(
        [...res.announcements].sort((a, b) => b.createdAt - a.createdAt),
      );
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Failed to load announcements", err);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteAnnouncement(deleting.id);
      toast.success("Announcement deleted");
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error("Failed to delete announcement", err);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = can(claims?.role, "announcements.create");
  const canDelete = can(claims?.role, "announcements.delete");

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Published to clients via GET /v1/announcements while within their window."
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + New announcement
            </button>
          ) : undefined
        }
      />

      {loading || !items ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card">
              <div className="h-5 w-1/3 animate-pulse rounded bg-zinc-800" />
              <div className="mt-3 h-4 w-full animate-pulse rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No announcements"
          hint="Create one to notify clients of maintenance or news."
        />
      ) : (
        <ul className="space-y-4">
          {items.map((a) => {
            const live = isLive(a);
            return (
              <li key={a.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-zinc-100">
                        {a.title}
                      </h2>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          live
                            ? "border-emerald-700 bg-emerald-500/15 text-emerald-300"
                            : "border-zinc-700 bg-zinc-500/15 text-zinc-400"
                        }`}
                      >
                        {live ? "live" : "not live"}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                      {a.body}
                    </p>
                    <p className="mt-3 text-xs text-zinc-500">
                      Created {fmtDateTime(a.createdAt)}
                      {a.startsAt ? ` · from ${fmtDateTime(a.startsAt)}` : ""}
                      {a.endsAt ? ` · until ${fmtDateTime(a.endsAt)}` : ""}
                    </p>
                  </div>
                  {canDelete && (
                    <button
                      className="btn-danger shrink-0 px-3 py-1.5 text-xs"
                      onClick={() => setDeleting(a)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <CreateModal onClose={() => setCreating(false)} onDone={load} />
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={deleting ? `Delete “${deleting.title}”?` : ""}
        message="Clients will stop seeing this announcement immediately."
        confirmLabel="Delete"
        danger
        busy={busy}
      />
    </div>
  );
}
