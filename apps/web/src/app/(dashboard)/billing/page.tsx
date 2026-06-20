import { BillingClient } from "./billing-client";

// Billing home. The pilot-approval gate and plan selection live in the client
// component (it needs the in-memory access token, which only exists client-side).
export default function BillingPage() {
  return <BillingClient />;
}
