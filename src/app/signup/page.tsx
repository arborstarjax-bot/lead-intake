import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";
import { Logo } from "@/components/Logo";
import { getSessionMembership } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ join?: string }>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // If the user is already signed in and a member, there's nothing to
  // sign up for — send them into the app. If they're signed in but
  // orphaned, /workspace has the rejoin/sign-out affordances.
  const membership = await getSessionMembership();
  if (membership) redirect("/");

  const params = (await searchParams) ?? {};
  const rawInvite = (params.join ?? "").trim().toUpperCase();
  const inviteCode = /^[A-Z0-9]{8}$/.test(rawInvite) ? rawInvite : null;

  // Look up the workspace for the invite code so we can show the user
  // exactly which workspace they're joining. Uses the admin client
  // because the user isn't authenticated yet. A bad/expired code just
  // falls through to the normal join form.
  let inviteWorkspaceName: string | null = null;
  let inviteInvalid = false;
  if (inviteCode) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("workspaces")
      .select("name")
      .eq("join_code", inviteCode)
      .maybeSingle();
    if (data?.name) {
      inviteWorkspaceName = data.name;
    } else {
      inviteInvalid = true;
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo variant="full" size="lg" priority />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {inviteWorkspaceName ? "Join workspace" : "Create your account"}
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {inviteWorkspaceName
                ? `You've been invited to join ${inviteWorkspaceName}.`
                : "Start a workspace or join one with a code"}
            </p>
          </div>
        </div>
        <SignupForm
          inviteCode={inviteWorkspaceName ? inviteCode : null}
          inviteWorkspaceName={inviteWorkspaceName}
          inviteInvalid={inviteInvalid}
        />
        <p className="text-sm text-center text-[var(--muted)]">
          Already have an account?{" "}
          <Link
            href={
              inviteCode
                ? `/login?next=${encodeURIComponent(`/signup?join=${inviteCode}`)}`
                : "/login"
            }
            className="text-[var(--accent)] font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
