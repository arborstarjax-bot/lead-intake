import Link from "next/link";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Start a workspace or join one with a code
          </p>
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
