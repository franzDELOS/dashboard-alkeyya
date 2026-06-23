"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch, formatDate } from "../../(dashboard)/billing/billing-shared";
import { buttonClass, errorClass } from "../../auth-ui";
import { PriorityBadge, displayName } from "../admin-shared";

type UserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
};

type RequestRow = {
  id: string;
  subject: string;
  priority: string;
  createdAt: string;
  user: { id: string; email: string; firstName: string | null; lastName: string | null };
};

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<{
    totalUsers: number;
    pendingApproval: number;
    openRequests: number;
    activeSubscriptions: number;
  } | null>(null);
  const [pending, setPending] = useState<UserRow[]>([]);
  const [openRequests, setOpenRequests] = useState<RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [allUsers, pendingRes, openRes, activeRes] = await Promise.all([
        authedFetch("/api/admin/users?limit=1"),
        authedFetch("/api/admin/users?status=pending_approval&limit=5"),
        authedFetch("/api/admin/requests?status=open&limit=5"),
        authedFetch("/api/admin/users?status=active&limit=1"),
      ]);
      if (!allUsers.ok || !pendingRes.ok || !openRes.ok || !activeRes.ok) {
        setError("We couldn't load the overview. Please refresh.");
        return;
      }
      const all = await allUsers.json();
      const pend = await pendingRes.json();
      const open = await openRes.json();
      const active = await activeRes.json();
      setStats({
        totalUsers: all.total,
        pendingApproval: pend.total,
        openRequests: open.total,
        activeSubscriptions: active.total,
      });
      setPending(pend.users as UserRow[]);
      setOpenRequests(open.requests as RequestRow[]);
    } catch {
      setError("We couldn't load the overview. Please refresh.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(userId: string) {
    setApproving(userId);
    try {
      const res = await authedFetch(
        `/api/admin/users/${userId}/approve-pilot`,
        { method: "POST" }
      );
      if (res.ok) await load();
    } finally {
      setApproving(null);
    }
  }

  return (
    <div className="space-y-8">
      {error ? <p className={errorClass}>{error}</p> : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total users" value={stats?.totalUsers} />
        <StatCard label="Pending approval" value={stats?.pendingApproval} />
        <StatCard label="Open requests" value={stats?.openRequests} />
        <StatCard
          label="Active subscriptions"
          value={stats?.activeSubscriptions}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg text-ink">Pending Approval</h2>
          <div className="mt-4">
            {pending.length === 0 ? (
              <p className="text-sm text-slate">No users awaiting approval.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {pending.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {displayName(u)}
                      </p>
                      <p className="truncate text-xs text-slate">{u.email}</p>
                      <p className="mt-0.5 text-xs text-slate">
                        Joined {formatDate(u.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => approve(u.id)}
                      disabled={approving === u.id}
                      className={`${buttonClass} w-auto px-3 py-1.5 text-xs`}
                    >
                      {approving === u.id ? "Approving…" : "Approve"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg text-ink">Recent Open Requests</h2>
          <div className="mt-4">
            {openRequests.length === 0 ? (
              <p className="text-sm text-slate">No open requests.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {openRequests.map((r) => (
                  <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/admin/requests/${r.id}`}
                        className="min-w-0 flex-1"
                      >
                        <p className="truncate text-sm font-medium text-ink hover:text-signal">
                          {r.subject}
                        </p>
                        <p className="truncate text-xs text-slate">
                          {displayName(r.user)}
                        </p>
                      </Link>
                      <PriorityBadge priority={r.priority} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl text-ink">
        {value === undefined ? "—" : value}
      </p>
    </div>
  );
}
