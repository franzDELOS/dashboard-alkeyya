import { CheckoutClient } from "./checkout-client";

// Dynamic route segment. We unwrap params server-side (Next 16 hands them in as
// a Promise) and pass the plain planId to the client component that initiates
// the Polar hosted checkout redirect.
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <CheckoutClient planId={planId} />;
}
