"use client";

import { useState } from "react";
import Link from "next/link";
import {
  buttonClass,
  inputClass,
  labelClass,
  linkClass,
} from "../auth-ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Always show the same generic confirmation, mirroring the backend's
      // privacy-preserving behavior — we never reveal whether the email exists.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Intentionally ignored — still show the generic confirmation.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">
          If that email exists, we&apos;ve sent a reset link. Check your inbox.
        </p>
        <Link href="/login" className={linkClass}>
          Back to log in
        </Link>
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

      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-center text-sm text-slate">
        Remembered it?{" "}
        <Link href="/login" className={linkClass}>
          Log in
        </Link>
      </p>
    </form>
  );
}
