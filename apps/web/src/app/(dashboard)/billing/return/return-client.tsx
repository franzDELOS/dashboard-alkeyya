"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, BillingShell } from "../billing-shared";

type State =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "failed" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fresh checkout lands here as "trialing" (trial) or "active" (no trial).
const SUBSCRIBED_STATUSES = new Set(["trialing", "active"]);

export function ReturnClient({ checkoutId }: { checkoutId: string | null }) {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        // The source of truth is /billing/status. The subscription row is
        // written by the Polar webhook, which can land a moment after this
        // redirect, so poll a few times before giving up.
        if (checkoutId) {
          for (let attempt = 0; attempt < 6; attempt++) {
            const res = await authedFetch("/api/billing/status");
            if (res.status === 401) {
              router.replace("/login");
              return;
            }
            if (res.ok) {
              const data = (await res.json()) as {
                subscription: { status: string } | null;
              };
              if (
                data.subscription &&
                SUBSCRIBED_STATUSES.has(data.subscription.status)
              ) {
                setState({ kind: "success" });
                return;
              }
            }
            await sleep(1000);
          }
        }
        setState({ kind: "failed" });
      } catch {
        setState({ kind: "failed" });
      }
    })();
  }, [checkoutId, router]);

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Confirming your subscription…</p>
      </main>
    );
  }

  if (state.kind === "success") {
    return (
      <BillingShell title="You're subscribed">
        <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-display text-xl text-ink">
            Welcome aboard — your trial is live.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate">
            You&apos;re all set. Your 14-day free trial has started; we won&apos;t
            charge your card until it ends, and you can cancel anytime from the
            billing portal.
          </p>
          <Link
            href="/billing"
            className="mt-5 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
          >
            Go to billing
          </Link>
        </div>
      </BillingShell>
    );
  }

  return (
    <BillingShell title="Something went wrong">
      <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <p className="text-sm leading-relaxed text-slate">
          We couldn&apos;t confirm your subscription. If you completed payment,
          it may still be processing — check your billing page in a moment. If
          the problem persists, contact support and we&apos;ll sort it out.
        </p>
        <Link
          href="/billing"
          className="mt-5 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
        >
          Back to billing
        </Link>
      </div>
    </BillingShell>
  );
}
