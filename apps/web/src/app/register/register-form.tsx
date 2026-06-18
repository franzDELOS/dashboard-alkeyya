"use client";

import { useState } from "react";
import Link from "next/link";
import {
  buttonClass,
  errorClass,
  inputClass,
  labelClass,
  linkClass,
} from "../auth-ui";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          companyName: companyName || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmittedEmail(email);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!submittedEmail) return;
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: submittedEmail }),
      });
    } finally {
      setResendState("sent");
    }
  }

  // Confirmation state — we do not redirect; the user must check their inbox.
  if (submittedEmail) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">
          Check your email to verify your account. We sent a verification link
          to <span className="font-medium">{submittedEmail}</span>.
        </p>
        <p className="text-sm text-slate">
          Didn&apos;t get it?{" "}
          {resendState === "sent" ? (
            <span className="text-ink">Sent — check your inbox again.</span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === "sending"}
              className={`${linkClass} disabled:opacity-60`}
            >
              {resendState === "sending" ? "Resending…" : "Resend email"}
            </button>
          )}
        </p>
        <p className="text-sm text-slate">
          Already verified?{" "}
          <Link href="/login" className={linkClass}>
            Log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate">
          At least 8 characters, including a letter and a number.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className={labelClass}>
            First name
          </label>
          <input
            id="firstName"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>
            Last name
          </label>
          <input
            id="lastName"
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="companyName" className={labelClass}>
          Company <span className="text-slate">(optional)</span>
        </label>
        <input
          id="companyName"
          type="text"
          autoComplete="organization"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className={inputClass}
        />
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-slate">
        Already have an account?{" "}
        <Link href="/login" className={linkClass}>
          Log in
        </Link>
      </p>
    </form>
  );
}
