"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setAccessToken } from "../../auth-store";
import {
  buttonClass,
  errorClass,
  fieldWrapClass,
  inputClass,
  labelClass,
  successClass,
} from "../../auth-ui";
import { authedFetch } from "../billing/billing-shared";
import { useUser, type User } from "../user-context";

/**
 * Settings page — three stacked sections: profile, password, and a minimal
 * billing summary (the full billing UI lives at /billing). Renders inside the
 * (dashboard) layout, so it carries no chrome of its own.
 */
export default function SettingsPage() {
  return (
    <div className="max-w-xl space-y-6">
      <ProfileSection />
      <PasswordSection />
      <BillingSection />
    </div>
  );
}

/** Shared card chrome for each section. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-slate">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ---- Profile ----------------------------------------------------------------

function ProfileSection() {
  const { user, setUser } = useUser();
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [companyName, setCompanyName] = useState(user.companyName ?? "");
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authedFetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, companyName, email }),
      });

      if (res.status === 409) {
        setError("That email is already in use.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "We couldn't save your changes. Please try again.");
        return;
      }

      const data = (await res.json()) as { user: Omit<User, "emailVerifiedAt"> };
      // Update the shared context so the sidebar name/email refresh instantly.
      setUser({ ...user, ...data.user });
      setSuccess("Profile updated.");
    } catch {
      setError("We couldn't save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Profile" description="Update your name, company, and email.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={fieldWrapClass}>
            <span className={labelClass}>First name</span>
            <input
              className={inputClass}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </label>
          <label className={fieldWrapClass}>
            <span className={labelClass}>Last name</span>
            <input
              className={inputClass}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </label>
        </div>
        <label className={fieldWrapClass}>
          <span className={labelClass}>Company</span>
          <input
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </label>
        <label className={fieldWrapClass}>
          <span className={labelClass}>Email</span>
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {error ? <p className={errorClass}>{error}</p> : null}
        {success ? <p className={successClass}>{success}</p> : null}

        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Section>
  );
}

// ---- Password ---------------------------------------------------------------

function PasswordSection() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const res = await authedFetch("/api/settings/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "INVALID_PASSWORD") {
          setError("Current password is incorrect.");
          return;
        }
        // A non-INVALID_PASSWORD 401 means the session itself lapsed.
        setAccessToken(null);
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "We couldn't update your password. Please try again.");
        return;
      }

      // The server revoked every session and cleared the refresh cookie — send
      // the user back to login with a fresh token.
      setSuccess("Password updated. Redirecting to login…");
      setTimeout(() => {
        setAccessToken(null);
        router.replace("/login");
      }, 1500);
    } catch {
      setError("We couldn't update your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Password"
      description="Changing your password signs you out of all sessions."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className={fieldWrapClass}>
          <span className={labelClass}>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className={fieldWrapClass}>
          <span className={labelClass}>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label className={fieldWrapClass}>
          <span className={labelClass}>Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>

        {error ? <p className={errorClass}>{error}</p> : null}
        {success ? <p className={successClass}>{success}</p> : null}

        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? "Updating…" : "Update password"}
        </button>
      </form>
    </Section>
  );
}

// ---- Billing summary --------------------------------------------------------

type BillingStatus = {
  isPilotApproved: boolean;
  subscription: { planName: string; status: string } | null;
};

function BillingSection() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authedFetch("/api/billing/status");
        if (res.ok && active) {
          setStatus((await res.json()) as BillingStatus);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Section title="Billing">
      {loading ? (
        <p className="text-sm text-slate">Loading your plan…</p>
      ) : status?.subscription ? (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">
              {status.subscription.planName}
            </p>
            <p className="mt-0.5 text-sm text-slate capitalize">
              {status.subscription.status}
            </p>
          </div>
          <Link
            href="/billing"
            className="text-sm font-medium text-signal underline-offset-2 hover:underline"
          >
            Manage billing →
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate">No active subscription.</p>
          <Link
            href="/billing"
            className="text-sm font-medium text-signal underline-offset-2 hover:underline"
          >
            View plans →
          </Link>
        </div>
      )}
    </Section>
  );
}
