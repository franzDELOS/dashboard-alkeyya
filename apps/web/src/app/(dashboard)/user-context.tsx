"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The authenticated user, fetched once by the (dashboard) layout and shared
 * with every post-login page. This replaces the per-page /me fetches the
 * dashboard and billing pages used to each make on their own.
 */
export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  emailVerifiedAt: string | null;
  // Added in Phase 4: /me now returns the role so the (admin) layout can gate
  // on it. "customer" | "admin". Existing (dashboard) consumers ignore it.
  role: string;
};

type UserContextValue = {
  user: User;
  /** Replace the cached user (e.g. after a profile update) so the sidebar and
   *  any consumer re-render immediately without a page reload. */
  setUser: (user: User) => void;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  value,
  children,
}: {
  value: UserContextValue;
  children: ReactNode;
}) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

/** Access the authenticated user. Throws if used outside the (dashboard)
 *  layout — a guard that catches accidental use on a public page. */
export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within the (dashboard) layout");
  }
  return ctx;
}
