import { ReturnClient } from "./return-client";

// Stripe redirects here after embedded Checkout completes, with the session id
// in the query string. We unwrap searchParams server-side (Next 16 hands them
// in as a Promise) and let the client confirm the outcome with the API.
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  return <ReturnClient sessionId={session_id ?? null} />;
}
