"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  authedFetch,
  formatDate,
  formatPriceUsd,
} from "../../../../(dashboard)/billing/billing-shared";
import {
  buttonClass,
  errorClass,
  inputClass,
  linkClass,
  successClass,
} from "../../../../auth-ui";
import {
  PriorityBadge,
  StatusBadge,
  SubscriptionStatusBadge,
  auditActionLabel,
  displayName,
} from "../../../admin-shared";

type Invoice = {
  stripeInvoiceId: string | null;
  polarOrderId: string | null;
  amountPaidCents: number;
  status: string;
  hostedInvoiceUrl: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  totalAmount: number; // cents
  status: string;
  createdAt: string;
  productName: string | null;
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
  polarCustomerId: string | null;
  subscription: {
    planName: string;
    status: string;
    provider: string;
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

  // Billing controls (Phase 3): trial grant form + orders/refund.
  const [trialDays, setTrialDays] = useState("14");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

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

  // POST with a JSON body (the body-less version above is `act`). Returns whether
  // it succeeded so callers can reset their own form state.
  async function actBody(
    path: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/users/${userId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMessage(body.message ?? "Done.");
        return true;
      }
      setError(body.message ?? "That action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const loadOrders = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/users/${userId}/orders`);
      if (res.ok) {
        const data = (await res.json()) as { orders: Order[] };
        setOrders(data.orders);
      }
    } catch {
      // Non-fatal: the orders panel just stays empty.
    }
  }, [userId]);

  // Load Polar orders once we know the user has a Polar customer account.
  useEffect(() => {
    if (user?.polarCustomerId) void loadOrders();
  }, [user?.polarCustomerId, loadOrders]);

  async function grantTrial() {
    const days = Number(trialDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      setError("Enter a whole number of days from 1 to 90.");
      return;
    }
    if (await actBody("trial/grant", { days })) await load();
  }

  async function submitRefund(orderId: string) {
    const payload: Record<string, unknown> = { orderId };
    if (refundAmount.trim()) {
      const value = Number(refundAmount);
      if (!Number.isFinite(value) || value <= 0) {
        setError("Enter a refund amount greater than zero, or leave it blank.");
        return;
      }
      payload.amountCents = Math.round(value * 100);
    }
    if (refundReason.trim()) payload.reason = refundReason.trim();

    if (await actBody("refund", payload)) {
      setRefundFor(null);
      setRefundAmount("");
      setRefundReason("");
      await loadOrders();
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Subscription</h2>
          {user.subscription ? (
            <SubscriptionStatusBadge status={user.subscription.status} />
          ) : null}
        </div>
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

            {/* Trial controls — Polar subscriptions only. */}
            {user.subscription.provider === "polar" ? (
              <div className="rounded-lg border border-ink/10 bg-paper/50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate">
                  Trial controls
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {user.subscription.status === "trialing" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(
                          "trial/end",
                          "End this user's trial now? They will be charged today.",
                          "Trial ended."
                        )
                      }
                      className="w-auto rounded-lg border border-ink/15 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-paper disabled:opacity-60"
                    >
                      End trial now
                    </button>
                  ) : null}

                  <div>
                    <label className="text-xs text-slate">Days (1–90)</label>
                    <input
                      type="number"
                      min="1"
                      max="90"
                      className={`${inputClass} w-24`}
                      value={trialDays}
                      onChange={(e) => setTrialDays(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={grantTrial}
                    className={`${buttonClass} w-auto px-4`}
                  >
                    Grant trial
                  </button>
                </div>
              </div>
            ) : null}

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
                      key={
                        inv.polarOrderId ??
                        inv.stripeInvoiceId ??
                        inv.createdAt
                      }
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

        {/* Orders & refund — only for users with a Polar customer account. */}
        {user.polarCustomerId ? (
          <div className="mt-6 border-t border-ink/10 pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate">
              Polar orders
            </p>
            {orders === null ? (
              <p className="mt-2 text-sm text-slate">Loading orders…</p>
            ) : orders.length === 0 ? (
              <p className="mt-2 text-sm text-slate">No orders yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Amount</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10">
                    {orders.map((o) => (
                      <Fragment key={o.id}>
                        <tr>
                          <td className="py-2 pr-3 text-ink">
                            {formatPriceUsd(o.totalAmount).replace("/mo", "")}
                          </td>
                          <td className="py-2 pr-3 text-xs capitalize text-slate">
                            {o.status}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate">
                            {formatDate(o.createdAt)}
                          </td>
                          <td className="py-2">
                            {o.status === "paid" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setRefundFor(
                                    refundFor === o.id ? null : o.id
                                  )
                                }
                                className="text-xs font-medium text-signal underline-offset-2 hover:underline"
                              >
                                {refundFor === o.id ? "Cancel" : "Refund"}
                              </button>
                            ) : (
                              <span className="text-xs text-slate">—</span>
                            )}
                          </td>
                        </tr>
                        {refundFor === o.id ? (
                          <tr>
                            <td colSpan={4} className="pb-3">
                              <div className="rounded-lg border border-ink/10 bg-paper/50 p-3">
                                <div className="flex flex-wrap items-end gap-3">
                                  <div>
                                    <label className="text-xs text-slate">
                                      Amount (USD, blank = full)
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      inputMode="decimal"
                                      className={`${inputClass} w-32`}
                                      value={refundAmount}
                                      onChange={(e) =>
                                        setRefundAmount(e.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-xs text-slate">
                                      Reason (optional)
                                    </label>
                                    <input
                                      type="text"
                                      className={inputClass}
                                      value={refundReason}
                                      onChange={(e) =>
                                        setRefundReason(e.target.value)
                                      }
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => submitRefund(o.id)}
                                    className="w-auto rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-60"
                                  >
                                    Confirm Refund
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
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
