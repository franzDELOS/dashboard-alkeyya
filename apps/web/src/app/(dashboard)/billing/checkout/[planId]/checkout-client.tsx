"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, BillingShell } from "../../billing-shared";

type State =
  | { kind: "loading" }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

export function CheckoutClient({ planId }: { planId: string }) {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const handleBlocked = async (res: Response): Promise<void> => {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      const message =
        data.message ??
        (data.error === "ALREADY_SUBSCRIBED"
          ? "You already have an active subscription."
          : "You're not able to start a subscription yet.");
      setState({ kind: "blocked", message });
    };

    const genericError = () =>
      setState({
        kind: "error",
        message: "We couldn't start checkout. Please try again.",
      });

    (async () => {
      try {
        const res = await authedFetch("/api/billing/polar/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId }),
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 403 || res.status === 409 || res.status === 422) {
          await handleBlocked(res);
          return;
        }
        if (!res.ok) {
          genericError();
          return;
        }
        const { url } = (await res.json()) as { url: string | null };
        if (!url) {
          genericError();
          return;
        }
        // Full-page redirect to Polar's hosted checkout (Polar is the MoR).
        window.location.href = url;
      } catch {
        genericError();
      }
    })();
  }, [planId, router]);

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Preparing your checkout…</p>
      </main>
    );
  }

  return (
    <BillingShell title="Checkout">
      <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
        <p
          className={
            state.kind === "blocked" ? "text-sm text-ink" : "text-sm text-amber"
          }
        >
          {state.message}
        </p>
        <Link
          href="/billing"
          className="mt-4 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
        >
          Back to billing
        </Link>
      </div>
    </BillingShell>
  );
}
