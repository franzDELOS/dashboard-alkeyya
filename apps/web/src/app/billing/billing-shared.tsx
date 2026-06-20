"use client";

import type { ReactNode } from "react";
import { getAccessToken, setAccessToken } from "../auth-store";

/**
 * Shared helpers for the Phase 2 billing pages. Reuses the Phase 1 in-memory
 * access-token store (auth-store) — no second token store is introduced.
 */

/**
 * fetch() against /api with the current access token, transparently doing one
 * silent refresh + retry on 401 (same pattern as the dashboard). Returns the
 * final Response; a still-401 result means the caller should redirect to login.
 */
export async function authedFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const withAuth = (): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
    },
  });

  let res = await fetch(path, withAuth());
  if (res.status === 401) {
    const refresh = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (refresh.ok) {
      const data = (await refresh.json().catch(() => ({}))) as {
        accessToken?: string;
      };
      setAccessToken(data.accessToken ?? null);
      res = await fetch(path, withAuth());
    }
  }
  return res;
}

/** Cents → "$99/mo". Whole-dollar prices render without trailing ".00". */
export function formatPriceUsd(cents: number): string {
  const dollars = cents / 100;
  const text = Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
  return `${text}/mo`;
}

/** ISO/date string → "June 19, 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** The Keystone mark — Alkeyya's signature, drawn small and in Signal Blue. */
export function Keystone() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M10 6 H22 L27 26 H5 Z" fill="var(--color-signal)" />
      <path d="M16 6 V26" stroke="var(--color-paper)" strokeWidth="2.5" />
    </svg>
  );
}

/**
 * Page shell shared by the billing pages — mirrors the dashboard's restrained
 * layout (Keystone wordmark, centered column, brand tokens only).
 */
export function BillingShell({
  title,
  subtitle,
  children,
  width = "max-w-md",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className={`w-full ${width}`}>
        <div className="mb-8 flex items-center gap-3">
          <Keystone />
          <span className="font-display text-2xl tracking-tight text-ink">
            Alkeyya
          </span>
        </div>

        <h1 className="font-display text-3xl leading-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-slate">{subtitle}</p> : null}

        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
