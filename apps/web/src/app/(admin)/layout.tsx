"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authedFetch, Keystone } from "../(dashboard)/billing/billing-shared";
import type { User } from "../(dashboard)/user-context";
import { AdminProvider } from "./admin-context";

/** Admin sidebar navigation. URLs are unaffected by the (admin) route group. */
const NAV = [
  { label: "Overview", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Requests", href: "/admin/requests" },
  { label: "Audit Log", href: "/admin/audit" },
] as const;

/** Derive the topnav page title from the current path. */
function titleFor(pathname: string): string {
  if (pathname.startsWith("/admin/users/") && pathname !== "/admin/users") {
    return "User Detail";
  }
  if (pathname.startsWith("/admin/requests/") && pathname !== "/admin/requests") {
    return "Request Detail";
  }
  if (pathname.startsWith("/admin/users")) return "Users";
  if (pathname.startsWith("/admin/requests")) return "Requests";
  if (pathname.startsWith("/admin/audit")) return "Audit Log";
  return "Admin Overview";
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);
  const [admin, setAdmin] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // Admin guard: fetch /me once on mount. authedFetch() does the silent refresh
  // internally. A non-ok response means there's no valid session → /login. A
  // valid-but-non-admin user is sent home to /dashboard.
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const res = await authedFetch("/api/auth/me");
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const user = (await res.json()) as User;
        if (user.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        setAdmin(user);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Loading…</p>
      </main>
    );
  }

  if (!admin) return null; // redirecting

  return (
    <AdminProvider value={{ admin }}>
      <div className="min-h-screen md:flex">
        {menuOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          />
        ) : null}

        <Sidebar pathname={pathname} admin={admin} open={menuOpen} />

        <div className="flex min-w-0 flex-1 flex-col md:pl-64">
          <Topnav
            title={titleFor(pathname)}
            onToggleMenu={() => setMenuOpen((v) => !v)}
          />
          <main className="flex-1 p-6 md:p-10">{children}</main>
        </div>
      </div>
    </AdminProvider>
  );
}

function Sidebar({
  pathname,
  admin,
  open,
}: {
  pathname: string;
  admin: User;
  open: boolean;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-ink text-paper transition-transform md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Wordmark + Admin badge — the key visual differentiator from the
          customer view. */}
      <div className="flex items-center gap-2 px-6 py-6">
        <Keystone />
        <span className="font-display text-2xl tracking-tight text-white">
          Alkeyya
        </span>
        <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Admin
        </span>
      </div>

      <nav className="flex-1 px-3 py-2">
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block border-l-2 px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? "border-signal text-white"
                  : "border-transparent text-paper/55 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-6 py-5">
        <p className="truncate text-sm font-medium text-white">
          {admin.firstName ?? "Admin"}
        </p>
        <p className="mt-0.5 truncate text-xs text-paper/55">{admin.email}</p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block text-xs font-medium text-paper/55 underline-offset-2 transition hover:text-white hover:underline"
        >
          Back to dashboard →
        </Link>
      </div>
    </aside>
  );
}

function Topnav({
  title,
  onToggleMenu,
}: {
  title: string;
  onToggleMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-ink/10 bg-white px-4 md:px-10">
      <button
        type="button"
        aria-label="Open menu"
        onClick={onToggleMenu}
        className="rounded-lg p-2 text-ink transition hover:bg-paper md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="flex flex-1 items-center justify-center gap-2 md:hidden">
        <Keystone />
        <span className="font-display text-lg tracking-tight text-ink">
          Alkeyya
        </span>
        <span className="rounded-full bg-signal px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
          Admin
        </span>
      </div>

      <h1 className="hidden font-display text-xl text-ink md:block">{title}</h1>

      <span className="w-9 md:hidden" aria-hidden="true" />
    </header>
  );
}
