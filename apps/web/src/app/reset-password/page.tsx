import { AuthShell } from "../auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm token={token ?? null} />
    </AuthShell>
  );
}
