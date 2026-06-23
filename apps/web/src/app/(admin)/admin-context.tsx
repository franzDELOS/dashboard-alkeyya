"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../(dashboard)/user-context";

/**
 * The authenticated admin, fetched once by the (admin) layout and shared with
 * every admin page. Mirrors the (dashboard) UserProvider pattern, but kept
 * separate so the two route groups never share a provider instance. Reuses the
 * same `User` type — no duplicate type definition.
 */
type AdminContextValue = {
  admin: User;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  value,
  children,
}: {
  value: AdminContextValue;
  children: ReactNode;
}) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/** Access the authenticated admin. Throws if used outside the (admin) layout. */
export function useAdminUser(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error("useAdminUser must be used within the (admin) layout");
  }
  return ctx;
}
