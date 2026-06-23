"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  authedFetch,
  formatDate,
  formatPriceUsd,
} from "../../../../(dashboard)/billing/billing-shared";
import { buttonClass, errorClass, linkClass, successClass } from "../../../../auth-ui";
import {
  PriorityBadge,
  StatusBadge,
  auditActionLabel,
  displayName,
} from "../../../admin-shared";

type Invoice = {
  stripeInvoiceId: string;
  amountPaidCents: number;
  status: string;
  hostedInvoiceUrl: string | null;
  createdAt: string;
};

type RequestRow = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  createdAt: string;
};

type AuditRow = {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type UserDetail = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  role: string;
  isPilotApproved: boolean;
  suspendedAt: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  subscription: {
    planName: string;
    status: string;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    invoices: Invoice[];
  } | null;
  requests: RequestRow[];
  recentAuditLogs: AuditRow[];
};

export default function UserDetailPage() {
  const params = useParams();
  const userId = String(params.userId);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/users/${userId}`);
      if (!res.ok) {
        setError("We couldn't load this user.");
        return;
      }
      setUser(await res.json());
    } catch {
      setError("We couldn't load this user.");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, confirmMsg?: string, okMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await authedFetch(`/api/admin/users/${userId}/${path}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMessage(okMsg ?? body.message ?? "Done.");
        await load();
      } else {
        setError(body.message ?? "That action failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !user) return <p className={errorClass}>{error}</p>;
  if (!user) return <p className="text-sm text-slate">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className={`text-sm ${linkClass}`}>
        ← Back to users
      </Link>

      {message ? <p className={successClass}>{message}</p> : null}
      {error ? <p className={errorClass}>{error}</p> : null}

      {/* Account */}
      <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg text-ink">Account</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Name" value={displayName(user)} />
          <Field label="Email" value={user.email} />
          <Field label="Company" value={user.companyName ?? "—"} />
          <Field label="Role" value={user.role} />
          <Field
            label="Email verified"
            value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "Not verified"}
          />
          <Field label="Joined" value={formatDate(user.createdAt)} />
          <Field
            label="Pilot approval"
            value={user.isPilotApproved ? "Approved" : "Pending"}
          />
          <Field
            label="Account status"
            value={user.suspendedAt ? `Suspended ${formatDate(user.suspendedAt)}` : "Active"}
          />
        </dl>

        <div className="mt-5 flex flex-wrap gap-3">
          {!user.isPilotApproved ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("approve-pilot", undefined, "Pilot approved.")}
              className={`${buttonClass} w-auto px-4`}
            >
              Approve Pilot
            </button>
          ) : null}

          {user.role !== "admin" ? (
            user.suspendedAt ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => act("unsuspend", undefined, "Account unsuspended.")}
                className="w-auto rounded-lg border border-ink/15 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-paper disabled:opacity-60"
              >
                Unsuspend Account
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    "suspend",
                    `Suspend ${user.email}? They will lose access to the dashboard.`,
                    "Account suspended."
                  )
                }
                className="w-auto rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-60"
              >
                Suspend Account
              </button>
            )
          ) : null}
        </div>
      </section>

      {/* Subscription */}
      <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg text-ink">Subscription</h2>
        {user.subscription ? (
          <div className="mt-4 space-y-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Plan" value={user.subscription.planName} />
              <Field label="Status" value={user.subscription.status} />
              <Field
                label="Period end"
                value={formatDate(user.subscription.currentPeriodEnd)}
              />
              <Field
                label="Trial end"
                value={formatDate(user.subscription.trialEndsAt)}
              />
            </dl>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate">
                Invoices
              </p>
              {user.subscription.invoices.length === 0 ? (
                <p className="mt-2 text-sm text-slate">No invoices yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-ink/10">
                  {user.subscription.invoices.map((inv) => (
                    <li
                      key={inv.stripeInvoiceId}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="text-ink">
                        {formatPriceUsd(inv.amountPaidCents).replace("/mo", "")}
                      </span>
                      <span className="text-xs capitalize text-slate">
                        {inv.status}
                      </span>
                      <span className="text-xs text-slate">
                        {formatDate(inv.createdAt)}
                      </span>
                      {inv.hostedInvoiceUrl ? (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-xs ${linkClass}`}
                        >
                          View →
                        </a>
                      ) : (
                        <span className="text-xs text-slate">—</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate">No active subscription.</p>
        )}
      </section>

      {/* Requests */}
      <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg text-ink">Requests</h2>
        {user.requests.length === 0 ? (
          <p className="mt-4 text-sm text-slate">No requests.</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/10">
            {user.requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {r.subject}
                  </p>
                  <p className="mt-0.5 text-xs text-slate">
                    {formatDate(r.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PriorityBadge priority={r.priority} />
                  <StatusBadge status={r.status} />
                  <Link href={`/admin/requests/${r.id}`} className={`text-xs ${linkClass}`}>
                    View →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Audit activity */}
      <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg text-ink">Recent audit activity</h2>
        {user.recentAuditLogs.length === 0 ? (
          <p className="mt-4 text-sm text-slate">No recorded activity.</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/10">
            {user.recentAuditLogs.map((log, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="text-ink">{auditActionLabel(log.action)}</span>
                <span className="text-xs text-slate">
                  {formatDate(log.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
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
