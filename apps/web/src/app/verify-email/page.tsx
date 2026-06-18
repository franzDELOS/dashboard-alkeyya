import { AuthShell } from "../auth-shell";
import { VerifyEmailClient } from "./verify-email-client";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Verify your email">
      <VerifyEmailClient token={token ?? null} />
    </AuthShell>
  );
}
