"use client";

import { useRouter } from "next/navigation";
import { setAccessToken } from "../../auth-store";
import { buttonClass } from "../../auth-ui";
import { useUser } from "../user-context";

/**
 * Overview page. The (dashboard) layout now owns the auth guard, the loading
 * state, and the sidebar/topnav chrome — so this is just the account summary
 * plus a logout action, reading the user from context instead of fetching /me.
 */
export function DashboardClient() {
  const router = useRouter();
  const { user } = useUser();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAccessToken(null);
      router.replace("/login");
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="font-display text-3xl leading-tight text-ink">
        Welcome, {user.firstName ?? user.email}
      </h1>
      <p className="mt-2 text-sm text-slate">
        You&apos;re signed in. Use the navigation to manage billing, submit
        requests, or update your settings.
      </p>

      <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-slate">
          Account
        </p>
        <dl className="space-y-3 text-sm">
          <Row label="Email" value={user.email} />
          <Row
            label="Name"
            value={
              [user.firstName, user.lastName].filter(Boolean).join(" ") || "—"
            }
          />
          <Row label="Company" value={user.companyName ?? "—"} />
        </dl>
      </div>

      <div className="mt-6">
        <button type="button" onClick={handleLogout} className={buttonClass}>
          Log out
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
