"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { authedFetch, formatDate } from "../../../../(dashboard)/billing/billing-shared";
import { buttonClass, errorClass, linkClass, successClass } from "../../../../auth-ui";
import {
  PriorityBadge,
  StatusBadge,
  displayName,
  statusLabel,
} from "../../../admin-shared";

type RequestDetail = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  message: string;
  company: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  };
};

/** The single valid next status for each status (linear machine). */
const NEXT: Record<string, string | null> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: "closed",
  closed: null,
};

export default function RequestDetailPage() {
  const params = useParams();
  const requestId = String(params.requestId);
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/requests/${requestId}`);
      if (!res.ok) {
        setError("We couldn't load this request.");
        return;
      }
      setRequest(await res.json());
    } catch {
      setError("We couldn't load this request.");
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(next: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await authedFetch(
        `/api/admin/requests/${requestId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        status?: string;
      };
      if (res.ok) {
        setMessage(`Status updated to ${statusLabel(body.status ?? next)}.`);
        await load();
      } else {
        setError(body.message ?? "Couldn't update the status.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !request) return <p className={errorClass}>{error}</p>;
  if (!request) return <p className="text-sm text-slate">Loading…</p>;

  const next = NEXT[request.status] ?? null;
  const buttonLabel =
    next === "in_progress"
      ? "Mark In Progress"
      : next === "resolved"
        ? "Mark Resolved"
        : next === "closed"
          ? "Mark Closed"
          : null;

  return (
    <div className="space-y-6">
      <Link href="/admin/requests" className={`text-sm ${linkClass}`}>
        ← Back to requests
      </Link>

      {message ? <p className={successClass}>{message}</p> : null}
      {error ? <p className={errorClass}>{error}</p> : null}

      <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-display text-xl text-ink">{request.subject}</h2>
          <div className="flex items-center gap-2">
            <PriorityBadge priority={request.priority} />
            <StatusBadge status={request.status} />
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate">
              Submitted by
            </dt>
            <dd className="mt-0.5 text-sm text-ink">
              <Link href={`/admin/users/${request.user.id}`} className={linkClass}>
                {displayName(request.user)}
              </Link>{" "}
              <span className="text-slate">({request.user.email})</span>
            </dd>
          </div>
          <Field label="Company" value={request.company ?? request.user.companyName ?? "—"} />
          <Field label="Submitted" value={formatDate(request.createdAt)} />
          <Field label="Last updated" value={formatDate(request.updatedAt)} />
        </dl>

        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate">
            Message
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
            {request.message}
          </p>
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          {buttonLabel && next ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => advance(next)}
              className={`${buttonClass} w-auto px-4`}
            >
              {busy ? "Updating…" : buttonLabel}
            </button>
          ) : (
            <p className="text-sm text-slate">This request is closed.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
