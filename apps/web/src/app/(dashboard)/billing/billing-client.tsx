"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "../../auth-ui";
import {
  authedFetch,
  BillingShell,
  formatDate,
  formatPriceUsd,
} from "./billing-shared";

type Plan = {
  id: string;
  name: string;
  monthlyPriceUsd: number;
  features: string[];
};

type Subscription = {
  planName: string;
  monthlyPriceUsd: number;
  includedCalls: number | null;
  overageUnitCents: number | null;
  status: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
};

type Status = {
  billingProvider: "polar";
  isPilotApproved: boolean;
  subscription: Subscription | null;
};

// Statuses where the customer has a live Polar billing relationship worth
// managing (so we show the plan card + "Manage subscription"). A canceled
// subscription is deliberately excluded: we treat it as "no plan" so the
// customer sees the catalogue and can subscribe again, and is never shown a
// dead Manage button pointing at a non-existent portal.
const CURRENT_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "suspended",
]);

function hasCurrentSubscription(status: Status): boolean {
  return (
    !!status.subscription && CURRENT_STATUSES.has(status.subscription.status)
  );
}

export function BillingClient() {
  const router = useRouter();
  const ran = useRef(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const res = await authedFetch("/api/billing/status");
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setError("We couldn't load your billing details. Please try again.");
          return;
        }
        let data = (await res.json()) as Status;

        // If our DB shows no *current* subscription for an approved user, the
        // webhook may simply not have landed yet (or, in local dev, can't reach
        // us). Ask the server to reconcile with Polar's live state before we
        // conclude there's no plan — this is what keeps a just-subscribed
        // customer from seeing the "choose a plan" screen again. (A canceled row
        // isn't "current", so a re-subscribe is picked up here too.)
        if (data.isPilotApproved && !hasCurrentSubscription(data)) {
          const rec = await authedFetch("/api/billing/polar/reconcile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (rec.ok) {
            data = (await rec.json()) as Status;
          }
        }

        setStatus(data);

        // Only an approved user still without a current subscription needs the
        // catalogue.
        if (data.isPilotApproved && !hasCurrentSubscription(data)) {
          const plansRes = await authedFetch("/api/billing/plans");
          if (plansRes.ok) {
            const { plans: list } = (await plansRes.json()) as { plans: Plan[] };
            setPlans(list);
          }
        }
      } catch {
        setError("We couldn't load your billing details. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await authedFetch("/api/billing/polar/portal-session", {
        method: "POST",
      });
      if (res.ok) {
        const { url } = (await res.json()) as { url: string };
        window.location.href = url; // hosted provider portal — full redirect
        return;
      }
      setError("We couldn't open the billing portal. Please try again.");
    } catch {
      setError("We couldn't open the billing portal. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Loading your billing details…</p>
      </main>
    );
  }

  if (error || !status) {
    return (
      <BillingShell title="Billing">
        <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <p className="text-sm text-amber">
            {error ?? "Something went wrong."}
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </BillingShell>
    );
  }

  // --- State 1: pending pilot approval (the default for any new user) --------
  if (!status.isPilotApproved) {
    return (
      <BillingShell title="Billing">
        <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate">
            Account status
          </p>
          <h2 className="mt-3 font-display text-xl text-ink">
            Your account is pending pilot approval
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate">
            Alkeyya begins with a guided two-week pilot run by your account
            manager. Once that&apos;s complete and your account is approved,
            you&apos;ll be able to choose a plan and start your subscription
            here.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate">
            Questions in the meantime? Reach out to your account manager.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </BillingShell>
    );
  }

  // --- State 3: approved + current subscription ------------------------------
  if (status.subscription && hasCurrentSubscription(status)) {
    return (
      <BillingShell title="Billing" subtitle="Your Alkeyya subscription.">
        <SubscriptionCard
          sub={status.subscription}
          onManage={openPortal}
          portalLoading={portalLoading}
        />
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
        >
          Back to dashboard
        </Link>
      </BillingShell>
    );
  }

  // --- State 2: approved, no subscription yet → choose a plan ----------------
  return (
    <BillingShell
      title="Choose your plan"
      subtitle="Your 14-day free trial starts when you subscribe."
      width="max-w-5xl"
    >
      {plans && plans.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate">
          No plans are available right now. Please check back shortly.
        </p>
      )}
      <Link
        href="/dashboard"
        className="mt-8 inline-block text-sm font-medium text-signal underline-offset-2 hover:underline"
      >
        Back to dashboard
      </Link>
    </BillingShell>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-display text-2xl text-ink">{plan.name}</h2>
      <p className="mt-1 text-3xl font-semibold text-ink">
        {formatPriceUsd(plan.monthlyPriceUsd).replace("/mo", "")}
        <span className="text-base font-normal text-slate">/mo</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2 text-sm text-slate">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span aria-hidden="true" className="text-signal">
              ◆
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/billing/checkout/${plan.id}`}
        className={`${buttonClass} mt-6 inline-block text-center`}
      >
        Subscribe
      </Link>
    </div>
  );
}

function SubscriptionCard({
  sub,
  onManage,
  portalLoading,
}: {
  sub: Subscription;
  onManage: () => void;
  portalLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate">
        Current plan
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">{sub.planName}</h2>
        <span className="text-lg font-semibold text-ink">
          {formatPriceUsd(sub.monthlyPriceUsd)}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Status</dt>
          <dd className="text-ink">
            <StatusLine sub={sub} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Included calls</dt>
          <dd className="text-ink">
            {sub.includedCalls === null
              ? "Unlimited"
              : `${sub.includedCalls.toLocaleString()} / mo`}
          </dd>
        </div>
        {sub.overageUnitCents !== null ? (
          <div className="flex justify-between gap-3">
            <dt className="text-slate">Overage rate</dt>
            <dd className="text-ink">
              {formatOverage(sub.overageUnitCents)} / call
            </dd>
          </div>
        ) : null}
        {sub.currentPeriodEnd ? (
          <div className="flex justify-between gap-3">
            <dt className="text-slate">
              {sub.cancelAtPeriodEnd ? "Access ends" : "Renews"}
            </dt>
            <dd className="text-ink">{formatDate(sub.currentPeriodEnd)}</dd>
          </div>
        ) : null}
      </dl>

      {sub.cancelAtPeriodEnd ? (
        <p className="mt-3 text-sm text-amber">
          Your subscription is set to cancel on {formatDate(sub.currentPeriodEnd)}.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onManage}
        disabled={portalLoading}
        className={`${buttonClass} mt-6`}
      >
        {portalLoading ? "Opening…" : "Manage subscription"}
      </button>
    </div>
  );
}

/** Cents → "$0.49" (per-call overage price; always shown to the cent). */
function formatOverage(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Human-readable status, mapping our stored status strings to plain language. */
function StatusLine({ sub }: { sub: Subscription }) {
  switch (sub.status) {
    case "trialing":
      return <>Trial ends {formatDate(sub.trialEndsAt)}</>;
    case "active":
      return <>Active</>;
    case "suspended":
    case "past_due":
      return (
        <span className="text-amber">
          Payment issue — please update your payment method
        </span>
      );
    case "canceled":
      return <>Canceled</>;
    default:
      return <>{sub.status}</>;
  }
}
