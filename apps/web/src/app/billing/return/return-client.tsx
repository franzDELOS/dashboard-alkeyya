"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, BillingShell } from "../billing-shared";

type State =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "failed" };

export function ReturnClient({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!sessionId) {
      setState({ kind: "failed" });
      return;
    }

    (async () => {
      try {
        const res = await authedFetch(
          `/api/billing/checkout-session/${encodeURIComponent(sessionId)}`
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setState({ kind: "failed" });
          return;
        }
        const data = (await res.json()) as {
          status: string | null;
          paymentStatus: string | null;
        };
        // A completed Checkout Session reports status "complete". With a trial,
        // paymentStatus may be "no_payment_required" — completion is the signal.
        setState(data.status === "complete" ? { kind: "success" } : { kind: "failed" });
      } catch {
        setState({ kind: "failed" });
      }
    })();
  }, [sessionId, router]);

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
