"use client";

import { useEffect, useState } from "react";

type Probe = "checking" | "up" | "down";

export function StatusBoard() {
  const [api, setApi] = useState<Probe>("checking");
  const [db, setDb] = useState<Probe>("checking");

  useEffect(() => {
    let cancelled = false;

    // Same-origin: Nginx (prod) or a Next rewrite (dev) routes /api -> API.
    fetch("/api/ready")
      .then(async (res) => {
        const body = (await res.json()) as { database?: string };
        if (cancelled) return;
        setApi("up");
        setDb(body.database === "up" ? "up" : "down");
      })
      .catch(() => {
        if (cancelled) return;
        setApi("down");
        setDb("down");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ul className="space-y-3">
      <Row label="Web app" state="up" />
      <Row label="API service" state={api} />
      <Row label="Database" state={db} />
    </ul>
  );
}

function Row({ label, state }: { label: string; state: Probe }) {
  const color =
    state === "up"
      ? "var(--color-signal)"
      : state === "down"
        ? "var(--color-amber)"
        : "var(--color-slate)";
  const text =
    state === "up" ? "Online" : state === "down" ? "Unreachable" : "Checking…";

  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-ink">{label}</span>
      <span className="flex items-center gap-2 text-slate">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        {text}
      </span>
    </li>
  );
}
