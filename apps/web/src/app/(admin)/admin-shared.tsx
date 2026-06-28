"use client";

/**
 * Shared presentational helpers for the Phase 4 admin pages: priority/status
 * badges and the human-readable audit-action labels. Brand tokens only — colors
 * are applied via Tailwind utility classes built on the --color-* tokens.
 */

/** Human-readable labels for audit actions. Falls back to the raw action. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  pilot_approved: "Pilot approved",
  user_suspended: "Account suspended",
  user_unsuspended: "Account unsuspended",
  request_status_changed: "Request status changed",
  trial_granted: "Trial granted",
  trial_ended: "Trial ended early",
  plan_price_changed: "Plan price changed",
  refund_issued: "Refund issued",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Priority chip — amber/signal/ink/slate per the locked color spec. */
export function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    urgent: "bg-amber text-ink",
    high: "bg-signal text-white",
    normal: "bg-ink text-white",
    low: "bg-ink/20 text-ink",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        cls[priority] ?? "bg-ink/20 text-ink"
      }`}
    >
      {priority}
    </span>
  );
}

/** Request status chip — amber/signal/ink/paper per the locked color spec. */
export function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    open: "bg-amber/10 text-amber",
    in_progress: "bg-signal/10 text-signal",
    resolved: "bg-ink/10 text-ink",
    closed: "bg-paper text-slate",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        cls[status] ?? "bg-ink/10 text-ink"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

/** Billing status chip for a subscription row (distinct from the request
 *  StatusBadge above): active / free trial / past due / suspended / canceled. */
export function SubscriptionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-signal/10 text-signal", label: "Active" },
    trialing: { cls: "bg-amber/10 text-amber", label: "Free trial" },
    past_due: { cls: "bg-amber text-ink", label: "Past due" },
    suspended: { cls: "bg-ink/10 text-ink", label: "Suspended" },
    canceled: { cls: "bg-paper text-slate", label: "Canceled" },
  };
  const entry = map[status] ?? { cls: "bg-ink/10 text-ink", label: status };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

/** Account status chip used in the users list (approved / pending / suspended). */
export function UserStatusBadge({
  isPilotApproved,
  suspendedAt,
}: {
  isPilotApproved: boolean;
  suspendedAt: string | null;
}) {
  let label = "Pending";
  let cls = "bg-amber/10 text-amber";
  if (suspendedAt) {
    label = "Suspended";
    cls = "bg-ink/10 text-ink";
  } else if (isPilotApproved) {
    label = "Approved";
    cls = "bg-signal/10 text-signal";
  }
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/** Display name from first/last, falling back to the email. */
export function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email;
}
