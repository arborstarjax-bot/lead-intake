import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { getSessionMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Accepts an optional `?code=XXXXXXXX` param from an admin's invite
 * link. When present the signup form opens directly in "Join" mode with
 * the code pre-filled so the invitee only has to type email + password.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const membership = await getSessionMembership();
  if (membership) redirect("/");

  const params = await searchParams;
  const raw = (params.code ?? "").trim().toUpperCase();
  // Only treat as a real invite if it looks like an 8-char code, so a
  // malformed link falls back to the normal signup UI instead of
  // locking the user into a form they can't submit.
  const invitedCode = /^[A-Z0-9]{8}$/.test(raw) ? raw : null;

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {invitedCode ? "You're invited" : "Create your account"}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {invitedCode
              ? "Create an account to join the workspace"
              : "Start a new workspace or join one with a code"}
          </p>
        </div>
        <SignupForm invitedCode={invitedCode} />
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
