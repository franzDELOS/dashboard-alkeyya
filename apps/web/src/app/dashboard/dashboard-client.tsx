"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken, setAccessToken } from "../auth-store";
import { buttonClass } from "../auth-ui";

type Me = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  emailVerifiedAt: string | null;
};

/** GET /api/auth/me with the current in-memory access token. */
async function fetchMe(): Promise<Response> {
  return fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
}

export function DashboardClient() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        let res = await fetchMe();

        // Access token missing/expired: try one silent refresh, then retry once.
        if (res.status === 401) {
          const refresh = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (!refresh.ok) {
            router.replace("/login");
            return;
          }
          const refreshed = await refresh.json().catch(() => ({}));
          setAccessToken(refreshed.accessToken as string);
          res = await fetchMe();
        }

        if (!res.ok) {
          router.replace("/login");
          return;
        }

        setMe((await res.json()) as Me);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Loading your dashboard…</p>
      </main>
    );
  }

  if (!me) return null; // redirecting

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Keystone />
            <span className="font-display text-2xl tracking-tight text-ink">
              Alkeyya
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-slate underline-offset-2 hover:text-ink hover:underline"
          >
            Logout
          </button>
        </div>

        <h1 className="font-display text-3xl leading-tight text-ink">
          Welcome, {me.firstName ?? me.email}
        </h1>
        <p className="mt-2 text-sm text-slate">
          You&apos;re signed in. Your account dashboard arrives in a later phase.
        </p>

        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-slate">
            Account
          </p>
          <dl className="space-y-3 text-sm">
            <Row label="Email" value={me.email} />
            <Row
              label="Name"
              value={
                [me.firstName, me.lastName].filter(Boolean).join(" ") || "—"
              }
            />
            <Row label="Company" value={me.companyName ?? "—"} />
          </dl>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleLogout}
            className={buttonClass}
          >
            Log out
          </button>
        </div>
      </div>
    </main>
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

/** The Keystone mark — Alkeyya's signature, drawn small and in Signal Blue. */
function Keystone() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M10 6 H22 L27 26 H5 Z" fill="var(--color-signal)" />
      <path d="M16 6 V26" stroke="var(--color-paper)" strokeWidth="2.5" />
    </svg>
  );
}
