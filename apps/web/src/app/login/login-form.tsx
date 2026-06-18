"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setAccessToken } from "../auth-store";
import {
  buttonClass,
  errorClass,
  inputClass,
  labelClass,
  linkClass,
} from "../auth-ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // needed so the refresh_token cookie is stored
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 403 && body.error === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        return;
      }
      if (res.status === 401) {
        setError("Invalid email or password.");
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }

      setAccessToken(body.accessToken as string);
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setResendState("sent");
    }
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
        <div className="flex items-center justify-between">
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <Link href="/forgot-password" className={`text-xs ${linkClass}`}>
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      {error ? <p className={errorClass}>{error}</p> : null}

      {needsVerification ? (
        <div className="rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-ink">
          <p>Please verify your email before logging in.</p>
          <p className="mt-1 text-slate">
            {resendState === "sent" ? (
              <span className="text-ink">
                Verification email sent — check your inbox.
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={resendState === "sending" || !email}
                className={`${linkClass} disabled:opacity-60`}
              >
                {resendState === "sending"
                  ? "Sending…"
                  : "Resend verification email"}
              </button>
            )}
          </p>
        </div>
      ) : null}

      <button type="submit" disabled={submitting} className={buttonClass}>
        {submitting ? "Logging in…" : "Log in"}
      </button>

      <p className="text-center text-sm text-slate">
        Don&apos;t have an account?{" "}
        <Link href="/register" className={linkClass}>
          Create one
        </Link>
      </p>
    </form>
  );
}
