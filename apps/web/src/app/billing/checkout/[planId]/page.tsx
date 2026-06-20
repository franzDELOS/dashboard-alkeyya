import { CheckoutClient } from "./checkout-client";

// Dynamic route segment. We unwrap params server-side (Next 16 hands them in as
// a Promise) and pass the plain planId to the client component that drives the
// embedded Stripe Checkout.
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <CheckoutClient planId={planId} />;
}
