import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getSessionMembership } from "@/lib/auth";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  // If a fully-wired user is already signed in, they don't need to reset a
  // password — send them into the app.
  const membership = await getSessionMembership();
  if (membership) redirect("/");

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 px-4 py-12 bg-[var(--bg)]">
      <Logo variant="full" size="xl" priority />
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-sm text-center text-[var(--muted)]">
          Remembered it?{" "}
          <Link href="/login" className="text-[var(--accent)] font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
