"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, formatPriceUsd } from "../../../(dashboard)/billing/billing-shared";
import {
  buttonClass,
  errorClass,
  inputClass,
  successClass,
} from "../../../auth-ui";

type Plan = {
  id: string;
  name: string;
  monthlyPriceUsd: number; // cents
  features: string[];
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/billing/plans");
      if (!res.ok) {
        setError("We couldn't load plans. Please refresh.");
        return;
      }
      const data = (await res.json()) as { plans: Plan[] };
      setPlans(data.plans);
    } catch {
      setError("We couldn't load plans. Please refresh.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-ink">Plans</h1>
        <p className="mt-1 text-sm text-slate">
          Set the monthly price each plan charges on new checkouts.
        </p>
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      {plans === null ? (
        <p className="text-sm text-slate">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-slate">No plans configured.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  // Editor input is in DOLLARS; we convert to integer cents on submit.
  const [dollars, setDollars] = useState(String(plan.monthlyPriceUsd / 100));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setMessage(null);
    setError(null);

    const value = Number(dollars);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a price greater than zero.");
      return;
    }
    const monthlyPriceCents = Math.round(value * 100);

    setSaving(true);
    try {
      const res = await authedFetch(`/api/admin/plans/${plan.id}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyPriceCents }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMessage("Price updated.");
        onSaved();
      } else {
        setError(body.message ?? "Couldn't update the price.");
      }
    } catch {
      setError("Couldn't update the price.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-display text-xl text-ink">{plan.name}</h2>
      <p className="mt-1 text-sm text-slate">
        Current price: {formatPriceUsd(plan.monthlyPriceUsd)}
      </p>

      <div className="mt-4">
        <label className="text-xs font-medium uppercase tracking-wide text-slate">
          New price (USD / month)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-slate">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className={inputClass}
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={`${buttonClass} mt-3`}
        >
          {saving ? "Saving…" : "Save price"}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate">
        Existing subscribers keep their current price. Only new checkouts pay the
        updated amount.
      </p>

      {message ? <p className={`mt-2 ${successClass}`}>{message}</p> : null}
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}
    </div>
  );
}
