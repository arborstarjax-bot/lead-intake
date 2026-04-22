import { Logo } from "@/components/Logo";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 px-4 py-12 bg-[var(--bg)]">
      <Logo variant="full" size="xl" priority />
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set a new password
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Choose a password of at least 8 characters.
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
