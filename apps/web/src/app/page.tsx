import { StatusBoard } from "./status-board";

/**
 * Phase 0 boot screen. Not a marketing page — a quiet "the stack is alive"
 * shell. Its one job is to confirm the web -> api -> database chain is wired,
 * which is exactly what Phase 0 delivers. The real authenticated layout
 * arrives in Phase 1.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Keystone />
          <span className="font-display text-2xl tracking-tight text-ink">
            Alkeyya
          </span>
        </div>

        <h1 className="font-display text-3xl leading-tight text-ink">
          Customer dashboard
        </h1>
        <p className="mt-2 text-sm text-slate">
          Phase 0 — infrastructure online. Accounts and billing arrive next.
        </p>

        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-slate">
            System status
          </p>
          <StatusBoard />
        </div>
      </div>
    </main>
  );
}

/** The Keystone mark — Alkeyya's signature, drawn small and in Signal Blue. */
function Keystone() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 6 H22 L27 26 H5 Z"
        fill="var(--color-signal)"
      />
      <path d="M16 6 V26" stroke="var(--color-paper)" strokeWidth="2.5" />
    </svg>
  );
}
