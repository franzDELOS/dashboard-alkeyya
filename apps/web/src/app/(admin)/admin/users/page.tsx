"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch, formatDate } from "../../../(dashboard)/billing/billing-shared";
import { errorClass, inputClass, linkClass } from "../../../auth-ui";
import { UserStatusBadge, displayName } from "../../admin-shared";

type UserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  isPilotApproved: boolean;
  suspendedAt: string | null;
  createdAt: string;
  subscription: { planName: string; status: string } | null;
};

const TABS = [
  { value: "all", label: "All" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    users: UserRow[];
    totalPages: number;
    total: number;
    page: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search input by 300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [debounced, status]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
      });
      if (debounced) params.set("search", debounced);
      const res = await authedFetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        setError("We couldn't load users. Please refresh.");
        return;
      }
      setData(await res.json());
    } catch {
      setError("We couldn't load users. Please refresh.");
    }
  }, [status, page, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className={`${inputClass} sm:max-w-xs`}
          placeholder="Search by name, email, or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              status === tab.value
                ? "bg-ink text-white"
                : "bg-ink/5 text-slate hover:bg-ink/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase tracking-wide text-slate">
            <tr>
              <th className="px-4 py-3 font-medium">Name / Email</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {data && data.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate">
                  No users match your filters.
                </td>
              </tr>
            ) : (
              data?.users.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{displayName(u)}</p>
                    <p className="text-xs text-slate">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink">{u.companyName ?? "—"}</td>
                  <td className="px-4 py-3 text-ink">
                    {u.subscription ? u.subscription.planName : "No subscription"}
                  </td>
                  <td className="px-4 py-3">
                    <UserStatusBadge
                      isPilotApproved={u.isPilotApproved}
                      suspendedAt={u.suspendedAt}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className={linkClass}>
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={data?.page ?? page}
        totalPages={data?.totalPages ?? 1}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1}
        className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Previous
      </button>
      <span className="text-xs text-slate">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages}
        className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}
