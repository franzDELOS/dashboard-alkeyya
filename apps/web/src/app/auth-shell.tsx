import type { ReactNode } from "react";

/**
 * Server component shell shared by every auth page. Mirrors the Phase 0 boot
 * screen (apps/web/src/app/page.tsx): centered card, Keystone wordmark, the
 * same brand tokens and visual restraint. Client forms render as children.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Keystone />
          <span className="font-display text-2xl tracking-tight text-ink">
            Alkeyya
          </span>
        </div>

        <h1 className="font-display text-3xl leading-tight text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-2 text-sm text-slate">{subtitle}</p>
        ) : null}

        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </main>
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
