import { ReturnClient } from "./return-client";

// Both providers redirect here after checkout: Stripe with `session_id` (its
// embedded Checkout) and Polar with `checkout_id` (its hosted checkout). We
// unwrap searchParams server-side (Next 16 hands them in as a Promise) and let
// the client confirm the outcome — Stripe via the session, Polar via the
// authoritative /billing/status.
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; checkout_id?: string }>;
}) {
  const { session_id, checkout_id } = await searchParams;
  return (
    <ReturnClient
      sessionId={session_id ?? null}
      checkoutId={checkout_id ?? null}
    />
  );
}
