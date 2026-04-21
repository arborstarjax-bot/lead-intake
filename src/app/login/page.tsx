import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { SignedInNotice } from "./SignedInNotice";
import { getSessionMembership } from "@/lib/auth";
import { createSSRClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeRedirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  // If the user is already signed in AND in a workspace, there's nothing
  // to do here — send them into the app (or wherever they were headed).
  const membership = await getSessionMembership();
  if (membership) redirect(next);

  // Signed in but orphaned (no workspace membership): show a sign-out +
  // rejoin prompt instead of the login form so they're never trapped.
  const supabase = await createSSRClient();
  const { data: userRes } = await supabase.auth.getUser();
  const orphanEmail = userRes.user?.email ?? null;

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-[var(--muted)]">
            Sign in to your workspace
          </p>
        </div>
        {orphanEmail ? (
          <SignedInNotice email={orphanEmail} />
        ) : (
          <LoginForm next={next} initialError={sp.error} />
        )}
        <p className="text-sm text-center text-[var(--muted)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[var(--accent)] font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
