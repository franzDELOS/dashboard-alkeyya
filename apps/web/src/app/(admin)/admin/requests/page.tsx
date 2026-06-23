"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch, formatDate } from "../../../(dashboard)/billing/billing-shared";
import { errorClass, inputClass, linkClass } from "../../../auth-ui";
import { PriorityBadge, StatusBadge, displayName } from "../../admin-shared";
import { Pagination } from "../users/page";

type RequestRow = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  createdAt: string;
  user: { id: string; email: string; firstName: string | null; lastName: string | null; companyName: string | null };
};

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "all", label: "All priorities" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export default function AdminRequestsPage() {
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    requests: RequestRow[];
    totalPages: number;
    page: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, priority]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        priority,
        page: String(page),
      });
      const res = await authedFetch(`/api/admin/requests?${params.toString()}`);
      if (!res.ok) {
        setError("We couldn't load requests. Please refresh.");
        return;
      }
      setData(await res.json());
    } catch {
      setError("We couldn't load requests. Please refresh.");
    }
  }, [status, priority, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
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
        <select
          className={`${inputClass} sm:max-w-[180px]`}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase tracking-wide text-slate">
            <tr>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Submitted by</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {data && data.requests.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate">
                  No requests match your filters.
                </td>
              </tr>
            ) : (
              data?.requests.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-ink">{r.subject}</td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={r.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{displayName(r.user)}</p>
                    <p className="text-xs text-slate">{r.user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/requests/${r.id}`} className={linkClass}>
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
