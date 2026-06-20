import { DashboardClient } from "./dashboard-client";

// Minimal placeholder authenticated page. The full authenticated layout
// (sidebar / topnav) is intentionally out of scope for Phase 1 — this exists
// only to prove the access-token + refresh flow works end to end.
export default function DashboardPage() {
  return <DashboardClient />;
}
