"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { useToast } from "@/components/Toast";
import { logout } from "@/app/login/actions";
import { joinExistingWorkspace } from "./actions";

export function OrphanWorkspaceClient({ email }: { email: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [signingOut, startSignOut] = useTransition();
  const [joining, startJoin] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    startSignOut(async () => {
      await logout();
      router.replace("/login");
      router.refresh();
    });
  }

  function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const joinCode = code.trim().toUpperCase();
    if (joinCode.length !== 8) {
      setError("Join code must be 8 characters");
      return;
    }
    startJoin(async () => {
      const res = await joinExistingWorkspace(joinCode);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast({ kind: "success", message: "Joined workspace" });
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-2">
        <h2 className="text-sm font-semibold">You&apos;re not in a workspace</h2>
        <p className="text-sm text-[var(--muted)]">
          Signed in as <span className="font-medium text-[var(--fg)]">{email}</span>, but
          you&apos;re not a member of any workspace. This can happen if an admin
          removed you or you finished email confirmation but haven&apos;t joined
          one yet. Enter a join code below, or sign out to use a different
          account.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold">Join a workspace</h2>
        <form className="space-y-3" onSubmit={join}>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
              Join code
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={8}
              minLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm font-mono uppercase tracking-widest"
              placeholder="8 characters"
            />
          </label>
          {error ? (
            <div
              role="alert"
              className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2"
            >
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={joining}
            className="w-full h-11 rounded-full bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {joining ? "Joining…" : "Join workspace"}
          </button>
        </form>
      </section>

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="w-full h-11 rounded-full border border-[var(--border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
