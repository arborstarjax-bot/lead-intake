"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link as LinkIcon, Loader2, RotateCcw, Shield, UserMinus, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { logout } from "@/app/login/actions";

type Member = {
  userId: string;
  email: string | null;
  role: "admin" | "user";
  joinedAt: string;
  isSelf: boolean;
};

type Props = {
  workspace: { id: string; name: string; joinCode: string };
  role: "admin" | "user";
  members: Member[];
};

export function WorkspaceClient({ workspace, role, members: initialMembers }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [joinCode, setJoinCode] = useState(workspace.joinCode);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = role === "admin";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(joinCode);
      toast({ kind: "success", message: "Join code copied" });
    } catch {
      toast({ kind: "error", message: "Copy failed — select the code manually" });
    }
  }

  async function copyInviteLink() {
    // Build the invite URL on the client so self-hosting / custom
    // domains "just work" without an env var.
    const url = `${window.location.origin}/signup?code=${joinCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ kind: "success", message: "Invite link copied" });
    } catch {
      toast({ kind: "error", message: "Copy failed — long-press to copy manually" });
    }
  }

  async function rotateCode() {
    if (!isAdmin) return;
    if (!confirm("Rotate the join code? The current code will stop working.")) return;
    const res = await fetch("/api/workspace", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", message: json.error ?? "Rotate failed" });
      return;
    }
    setJoinCode(json.joinCode);
    toast({ kind: "success", message: "New join code generated" });
  }

  async function setRole(userId: string, next: "admin" | "user") {
    setBusyId(userId);
    try {
      const res = await fetch(`/api/workspace/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Update failed" });
        return;
      }
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: next } : m))
      );
      toast({ kind: "success", message: `Now ${next}` });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(userId: string, label: string) {
    if (!confirm(`Remove ${label} from the workspace?`)) return;
    setBusyId(userId);
    try {
      const res = await fetch(`/api/workspace/members/${userId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Remove failed" });
        return;
      }
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      toast({ kind: "success", message: "Removed" });
    } finally {
      setBusyId(null);
    }
  }

  function signOut() {
    startTransition(async () => {
      await logout();
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
        <div>
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
            Workspace
          </div>
          <div className="text-lg font-semibold">{workspace.name}</div>
        </div>

        <div className="rounded-xl bg-[var(--surface-2)] p-3 space-y-2">
          <div className="text-xs font-medium text-[var(--muted)]">
            Invite a teammate — share the link or the code
          </div>
          <button
            type="button"
            onClick={copyInviteLink}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-white h-11 text-sm font-semibold"
          >
            <LinkIcon className="h-4 w-4" /> Copy invite link
          </button>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xl tracking-widest bg-white border border-[var(--border)] rounded-lg px-3 h-11 flex items-center">
              {joinCode}
            </code>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm font-medium"
            >
              <Copy className="h-4 w-4" /> Code
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={rotateCode}
              className="inline-flex items-center gap-1.5 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Rotate code
            </button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Members ({members.length})</h2>
          {!isAdmin && (
            <span className="text-xs text-[var(--muted)]">
              Only admins can manage members
            </span>
          )}
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {members.map((m) => {
            const label = m.email ?? m.userId.slice(0, 8);
            const busy = busyId === m.userId;
            return (
              <li key={m.userId} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {label}
                    {m.isSelf && (
                      <span className="ml-1.5 text-xs text-[var(--muted)]">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Joined {new Date(m.joinedAt).toLocaleDateString()}
                  </div>
                </div>
                <span
                  className={cn(
                    "text-xs font-medium px-2 h-6 rounded-full inline-flex items-center gap-1",
                    m.role === "admin"
                      ? "bg-indigo-50 text-indigo-700"
                      : "bg-slate-100 text-slate-700"
                  )}
                >
                  {m.role === "admin" && <Shield className="h-3 w-3" />}
                  {m.role}
                </span>
                {isAdmin && !m.isSelf && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setRole(m.userId, m.role === "admin" ? "user" : "admin")
                      }
                      disabled={busy}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40"
                      aria-label={
                        m.role === "admin" ? "Demote to user" : "Promote to admin"
                      }
                      title={
                        m.role === "admin" ? "Demote to user" : "Promote to admin"
                      }
                    >
                      <UserCog className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(m.userId, label)}
                      disabled={busy}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[var(--border)] text-red-600 hover:bg-red-50 disabled:opacity-40"
                      aria-label={`Remove ${label}`}
                      title={`Remove ${label}`}
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-[var(--border)] bg-white text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Sign out
      </button>
    </div>
  );
}
