"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  buttonClass,
  errorClass,
  fieldWrapClass,
  inputClass,
  labelClass,
  successClass,
} from "../../auth-ui";
import { authedFetch, formatDate } from "../billing/billing-shared";
import { useUser } from "../user-context";

type RequestItem = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  message: string;
  createdAt: string;
};

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

/**
 * Requests page — a submission form (identity taken from the account, not
 * re-entered) over the customer's own request history. Renders inside the
 * (dashboard) layout.
 */
export default function RequestsPage() {
  const { user } = useUser();

  const [requests, setRequests] = useState<RequestItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setHistoryError(null);
    try {
      const res = await authedFetch("/api/requests");
      if (!res.ok) {
        setHistoryError("We couldn't load your requests. Please refresh.");
        return;
      }
      const data = (await res.json()) as { requests: RequestItem[] };
      setRequests(data.requests);
    } catch {
      setHistoryError("We couldn't load your requests. Please refresh.");
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  return (
    <div className="max-w-2xl space-y-6">
      <SubmitSection user={user} onSubmitted={loadRequests} />
      <HistorySection requests={requests} error={historyError} />
    </div>
  );
}

// ---- Submit -----------------------------------------------------------------

function SubmitSection({
  user,
  onSubmitted,
}: {
  user: { firstName: string | null; email: string; companyName: string | null };
  onSubmitted: () => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("normal");
  const [company, setCompany] = useState(user.companyName ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authedFetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          priority,
          message,
          company: company || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "We couldn't submit your request. Please try again.");
        return;
      }

      setSuccess("Request submitted! We'll be in touch soon.");
      setSubject("");
      setPriority("normal");
      setMessage("");
      // Company keeps its value — likely the same on the next request.
      await onSubmitted();
    } catch {
      setError("We couldn't submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-display text-xl text-ink">Submit a request</h2>
      <p className="mt-1 text-sm text-slate">
        Submitting as {user.firstName ?? "you"} ({user.email})
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <label className={fieldWrapClass}>
          <span className={labelClass}>Subject</span>
          <input
            className={inputClass}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What can we help with?"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={fieldWrapClass}>
            <span className={labelClass}>Priority</span>
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldWrapClass}>
            <span className={labelClass}>Company (optional)</span>
            <input
              className={inputClass}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>

        <label className={fieldWrapClass}>
          <span className={labelClass}>Message</span>
          <textarea
            className={`${inputClass} min-h-[120px] resize-y`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what you need…"
          />
        </label>

        {error ? <p className={errorClass}>{error}</p> : null}
        {success ? <p className={successClass}>{success}</p> : null}

        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </section>
  );
}

// ---- History ----------------------------------------------------------------

function HistorySection({
  requests,
  error,
}: {
  requests: RequestItem[] | null;
  error: string | null;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-display text-xl text-ink">Your requests</h2>

      <div className="mt-5">
        {error ? (
          <p className={errorClass}>{error}</p>
        ) : requests === null ? (
          <p className="text-sm text-slate">Loading your requests…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-slate">
            No requests yet. Use the form above to contact your account manager.
          </p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {requests.map((req) => (
              <li
                key={req.id}
                className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {req.subject}
                  </p>
                  <p className="mt-1 text-xs text-slate">
                    {formatDate(req.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PriorityBadge priority={req.priority} />
                  <StatusBadge status={req.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Color-coded priority chip — brand tokens only. */
function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    urgent: "bg-amber text-white",
    high: "bg-signal text-white",
    normal: "bg-ink text-white",
    low: "bg-slate text-white",
  };
  const cls = styles[priority] ?? "bg-slate text-white";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {priority}
    </span>
  );
}

/** Status chip — a quiet outline so it doesn't compete with the priority. */
function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-ink/15 px-2.5 py-0.5 text-xs font-medium capitalize text-slate">
      {status.replace("_", " ")}
    </span>
  );
}
