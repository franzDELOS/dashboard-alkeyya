import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to your Alkeyya dashboard.">
      <LoginForm />
    </AuthShell>
  );
}
