import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getSessionMembership } from "@/lib/auth";
import { createAdminClient, createSSRClient } from "@/lib/supabase/server";
import { WorkspaceClient } from "./WorkspaceClient";
import { OrphanWorkspaceClient } from "./OrphanWorkspaceClient";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string;
  role: "admin" | "user";
  created_at: string;
};

export default async function WorkspacePage() {
  const auth = await getSessionMembership();

  // No session at all — send them to sign in.
  if (!auth) {
    const supabase = await createSSRClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/login?next=/workspace");

    // Signed in but no workspace membership (e.g. admin removed them, or
    // email confirmed but never finished setup). Render an orphan state
    // so they can sign out — don't bounce to /login, middleware would
    // just send them right back here.
    return (
      <main className="mx-auto max-w-md p-4 sm:p-6 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg sm:text-xl font-semibold">No workspace</h1>
          <span className="text-xs text-[var(--muted)]">{data.user.email}</span>
        </header>
        <OrphanWorkspaceClient email={data.user.email ?? ""} />
      </main>
    );
  }

  const admin = createAdminClient();
  const [{ data: memberRows }, { data: users }] = await Promise.all([
    admin
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", auth.workspaceId)
      .order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const emailById = new Map<string, string>();
  for (const u of users?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }

  const members = (memberRows ?? []).map((m: MemberRow) => ({
    userId: m.user_id,
    email: emailById.get(m.user_id) ?? null,
    role: m.role,
    joinedAt: m.created_at,
    isSelf: m.user_id === auth.userId,
  }));

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" aria-label="Home" className="inline-flex items-center">
          <Logo variant="mark" size="sm" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Workspace</h1>
        <span className="text-xs text-[var(--muted)]">{auth.email}</span>
      </header>

      <WorkspaceClient
        workspace={{
          id: auth.workspaceId,
          name: auth.workspaceName,
          joinCode: auth.joinCode,
        }}
        role={auth.role}
        members={members}
      />
    </main>
  );
}
