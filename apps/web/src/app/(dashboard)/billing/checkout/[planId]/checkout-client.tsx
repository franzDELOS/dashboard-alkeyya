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

    // Both providers share the blocked-state handling (403 PILOT_NOT_APPROVED /
    // 409 ALREADY_SUBSCRIBED); only the success path differs (Stripe embeds a
    // client secret, Polar redirects to its hosted checkout).
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
        // Learn the active provider first so we hit the right checkout endpoint.
        const statusRes = await authedFetch("/api/billing/status");
        if (statusRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!statusRes.ok) {
          genericError();
          return;
        }
        const { billingProvider } = (await statusRes.json()) as {
          billingProvider: "stripe" | "polar";
        };

        if (billingProvider === "polar") {
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
          return;
        }

        // --- Stripe: embedded Checkout on our domain (unchanged) -------------
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
          await handleBlocked(res);
          return;
        }

        if (!res.ok) {
          genericError();
          return;
        }

        const { clientSecret } = (await res.json()) as {
          clientSecret: string | null;
        };
        if (!clientSecret) {
          genericError();
          return;
        }
        setState({ kind: "ready", clientSecret });
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
