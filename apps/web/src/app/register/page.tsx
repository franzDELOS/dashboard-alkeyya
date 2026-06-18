import { AuthShell } from "../auth-shell";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up access to your Alkeyya dashboard."
    >
      <RegisterForm />
    </AuthShell>
  );
}
