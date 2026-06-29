import { ReturnClient } from "./return-client";

// Polar redirects here after checkout with `checkout_id`. We unwrap
// searchParams server-side (Next 16 hands them in as a Promise) and let the
// client confirm the outcome by polling /billing/status.
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout_id?: string }>;
}) {
  const { checkout_id } = await searchParams;
  return <ReturnClient checkoutId={checkout_id ?? null} />;
}
