import { AuthShell } from "../auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
