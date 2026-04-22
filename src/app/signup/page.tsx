import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { Logo } from "@/components/Logo";
import { getSessionMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // If the user is already signed in and a member, there's nothing to
  // sign up for — send them into the app. If they're signed in but
  // orphaned, /workspace has the rejoin/sign-out affordances.
  const membership = await getSessionMembership();
  if (membership) redirect("/");

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo variant="full" size="lg" priority />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Create your account
            </h1>
            <p className="text-sm text-[var(--muted)]">
              Start a workspace or join one with a code
            </p>
          </div>
        </div>
        <SignupForm />
        <p className="text-sm text-center text-[var(--muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--accent)] font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
