"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setAccessToken } from "../auth-store";
import { authedFetch, Keystone } from "./billing/billing-shared";
import { UserProvider, type User } from "./user-context";

/** Sidebar navigation — label + the route it points at. URLs are unaffected by
 *  the (dashboard) route group, so these are the real paths. */
const NAV = [
  { label: "Overview", href: "/dashboard" },
  { label: "Billing", href: "/billing" },
  { label: "Requests", href: "/requests" },
  { label: "Settings", href: "/settings" },
] as const;

/** Derive the topnav page title from the current path. */
function titleFor(pathname: string): string {
  const match = NAV.find((item) => pathname.startsWith(item.href));
  return match?.label ?? "Dashboard";
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // Auth guard: fetch /me once on mount. authedFetch() does the silent refresh
  // internally, so a still-401 here means there's no valid session → login.
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
        setUser((await res.json()) as User);
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

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setAccessToken(null);
      router.replace("/login");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-slate">Loading your account…</p>
      </main>
    );
  }

  if (!user) return null; // redirecting

  return (
    <UserProvider value={{ user, setUser }}>
      <div className="min-h-screen md:flex">
        {/* Backdrop behind the mobile sidebar overlay. */}
        {menuOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          />
        ) : null}

        <Sidebar
          pathname={pathname}
          user={user}
          open={menuOpen}
          onLogout={handleLogout}
        />

        <div className="flex min-w-0 flex-1 flex-col md:pl-64">
          <Topnav
            title={titleFor(pathname)}
            onToggleMenu={() => setMenuOpen((v) => !v)}
          />
          <main className="flex-1 p-6 md:p-10">{children}</main>
        </div>
      </div>
    </UserProvider>
  );
}

function Sidebar({
  pathname,
  user,
  open,
  onLogout,
}: {
  pathname: string;
  user: User;
  open: boolean;
  onLogout: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-ink text-paper transition-transform md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Wordmark */}
      <div className="flex items-center gap-3 px-6 py-6">
        <Keystone />
        <span className="font-display text-2xl tracking-tight text-white">
          Alkeyya
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
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

      {/* Account footer */}
      <div className="border-t border-white/10 px-6 py-5">
        <p className="truncate text-sm font-medium text-white">
          {user.firstName ?? "Account"}
        </p>
        <p className="mt-0.5 truncate text-xs text-paper/55">{user.email}</p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-3 text-xs font-medium text-paper/55 underline-offset-2 transition hover:text-white hover:underline"
        >
          Log out
        </button>
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
      {/* Mobile: hamburger + centered wordmark. Desktop: just the title. */}
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
      </div>

      <h1 className="hidden font-display text-xl text-ink md:block">{title}</h1>

      {/* Spacer to balance the hamburger so the mobile wordmark stays centered. */}
      <span className="w-9 md:hidden" aria-hidden="true" />
    </header>
  );
}
