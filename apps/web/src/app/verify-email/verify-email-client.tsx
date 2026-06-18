"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { errorClass, linkClass } from "../auth-ui";

type State = "verifying" | "success" | "error";

export function VerifyEmailClient({ token }: { token: string | null }) {
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    // Guard against React 18/19 StrictMode double-invoke in development.
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setState("error");
      setMessage("No verification token was provided.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState("error");
          setMessage(
            body.error ?? "This verification link is invalid or has expired."
          );
          return;
        }
        setState("success");
        setMessage(body.message ?? "Email verified. You can now log in.");
      } catch {
        setState("error");
        setMessage("Network error. Please try again.");
      }
    })();
  }, [token]);

  if (state === "verifying") {
    return <p className="text-sm text-slate">Verifying your email…</p>;
  }

  if (state === "success") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">{message}</p>
        <Link href="/login" className={linkClass}>
          Continue to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className={errorClass}>{message}</p>
      <p className="text-sm text-slate">
        The link may have expired.{" "}
        <Link href="/register" className={linkClass}>
          Register again
        </Link>{" "}
        to receive a new one.
      </p>
    </div>
  );
}
