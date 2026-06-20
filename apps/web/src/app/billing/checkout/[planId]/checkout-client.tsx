"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { authedFetch, BillingShell } from "../../billing-shared";

// loadStripe is memoized at module scope so the SDK loads once, not per render.
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise: Promise<Stripe | null> = publishableKey
  ? loadStripe(publishableKey)
  : Promise.resolve(null);

type State =
  | { kind: "loading" }
  | { kind: "ready"; clientSecret: string }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

export function CheckoutClient({ planId }: { planId: string }) {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const res = await authedFetch("/api/billing/checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId }),
        });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 403 || res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          // PILOT_NOT_APPROVED → not yet approved; ALREADY_SUBSCRIBED → has one.
          const message =
            data.message ??
            (data.error === "ALREADY_SUBSCRIBED"
              ? "You already have an active subscription."
              : "You're not able to start a subscription yet.");
          setState({ kind: "blocked", message });
          return;
        }

        if (!res.ok) {
          setState({
            kind: "error",
            message: "We couldn't start checkout. Please try again.",
          });
          return;
        }

        const { clientSecret } = (await res.json()) as {
          clientSecret: string | null;
        };
        if (!clientSecret) {
          setState({
            kind: "error",
            message: "We couldn't start checkout. Please try again.",
          });
          return;
        }
        setState({ kind: "ready", clientSecret });
      } catch {
        setState({
          kind: "error",
          message: "We couldn't start checkout. Please try again.",
        });
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

  if (state.kind === "blocked" || state.kind === "error") {
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

  // Embedded Checkout stays on app.alkeyya.com — no redirect to Stripe-hosted.
  return (
    <BillingShell
      title="Complete your subscription"
      subtitle="Your 14-day free trial starts today. You can cancel anytime."
      width="max-w-2xl"
    >
      <div className="rounded-xl border border-ink/10 bg-white p-2 shadow-sm">
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{ clientSecret: state.clientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
      <Link
        href="/billing"
        className="mt-6 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
      >
        Cancel and go back
      </Link>
    </BillingShell>
  );
}
