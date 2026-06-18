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

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body.error ?? "This reset link is invalid or has expired."
        );
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">
          Password updated. You can now log in with your new password.
        </p>
        <Link href="/login" className={linkClass}>
          Continue to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="newPassword" className={labelClass}>
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate">
          At least 8 characters, including a letter and a number.
        </p>
      </div>

      <div>
        <label htmlFor="confirm" className={labelClass}>
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? "Updating…" : "Update password"}
      </button>

      <p className="text-center text-sm text-slate">
        <Link href="/login" className={linkClass}>
          Back to log in
        </Link>
      </p>
    </form>
  );
}
