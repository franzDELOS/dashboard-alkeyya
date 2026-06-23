"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "../../../(dashboard)/billing/billing-shared";
import { errorClass, inputClass } from "../../../auth-ui";
import { auditActionLabel, displayName } from "../../admin-shared";
import { Pagination } from "../users/page";

type AuditRow = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; email: string; firstName: string | null; lastName: string | null };
};

const RESOURCE_OPTIONS = [
  { value: "all", label: "All resources" },
  { value: "user", label: "User" },
  { value: "request", label: "Request" },
  { value: "subscription", label: "Subscription" },
] as const;

/** ISO string → "Jun 24, 2026, 3:14 PM". */
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AuditLogPage() {
  const [resourceType, setResourceType] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    logs: AuditRow[];
    totalPages: number;
    page: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [resourceType]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (resourceType !== "all") params.set("resourceType", resourceType);
      const res = await authedFetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) {
        setError("We couldn't load the audit log. Please refresh.");
        return;
      }
      setData(await res.json());
    } catch {
      setError("We couldn't load the audit log. Please refresh.");
    }
  }, [resourceType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <select
          className={`${inputClass} sm:max-w-[200px]`}
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
        >
          {RESOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-sm">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase tracking-wide text-slate">
            <tr>
              <th className="px-4 py-3 font-medium">Admin</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Resource</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {data && data.logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate">
                  No audit entries yet.
                </td>
              </tr>
            ) : (
              data?.logs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="text-ink">{displayName(log.actor)}</p>
                    <p className="text-xs text-slate">{log.actor.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {auditActionLabel(log.action)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-ink">{log.resourceType}</span>
                    <span className="ml-1 text-xs text-slate">
                      {log.resourceId.slice(0, 8)}…
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate">
                    {formatDateTime(log.createdAt)}
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
