"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { useToast } from "@/components/Toast";
import { logout } from "@/app/login/actions";
import { createOwnWorkspace, joinExistingWorkspace } from "./actions";

// Orphan = authenticated user with no workspace_members row. Common
// paths here: (1) admin removed them, (2) OAuth sign-in via Apple /
// Google (no workspace was created during sign-up), (3) email-
// confirmation completed but signup action never finished wiring up
// a workspace. In all three cases the user needs to pick create vs.
// join before they can enter the app.
type Mode = "create" | "join";

export function OrphanWorkspaceClient({ email }: { email: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [signingOut, startSignOut] = useTransition();
  const [working, startWork] = useTransition();
  // If they came in via /signup?join=CODE → Apple redirect, the join
  // code is carried through as ?join= so we can drop them straight
  // into the "join" tab with the code already filled in.
  const initialCode = (searchParams.get("join") ?? "").toUpperCase();
  const [mode, setMode] = useState<Mode>(initialCode ? "join" : "create");
  const [code, setCode] = useState(initialCode.slice(0, 8));
  const [wsName, setWsName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function signOut() {
    startSignOut(async () => {
      await logout();
      router.replace("/login");
      router.refresh();
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (mode === "join") {
      const joinCode = code.trim().toUpperCase();
      if (joinCode.length !== 8) {
        setError("Join code must be 8 characters");
        return;
      }
      startWork(async () => {
        const res = await joinExistingWorkspace(joinCode);
        if (res.error) {
          setError(res.error);
          return;
        }
        toast({ kind: "success", message: "Joined workspace" });
        router.replace("/");
        router.refresh();
      });
      return;
    }
    // create mode
    const name = wsName.trim();
    if (!name) {
      setError("Workspace name is required");
      return;
    }
    startWork(async () => {
      const res = await createOwnWorkspace(name);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast({ kind: "success", message: "Workspace created" });
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-2">
        <h2 className="text-sm font-semibold">You&apos;re not in a workspace</h2>
        <p className="text-sm text-[var(--muted)]">
          Signed in as <span className="font-medium text-[var(--fg)]">{email}</span>. Start
          a new workspace or join an existing one with a code.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-[var(--surface-2)] p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => {
              setMode("create");
              setError(null);
            }}
            className={`h-9 rounded-full transition-colors ${
              mode === "create"
                ? "bg-white text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
          >
            Create workspace
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("join");
              setError(null);
            }}
            className={`h-9 rounded-full transition-colors ${
              mode === "join"
                ? "bg-white text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
          >
            Join with code
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          {mode === "create" ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                Workspace name
              </span>
              <input
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                maxLength={80}
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm"
                placeholder="e.g. Arbor Tech 904"
              />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                Join code
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                maxLength={8}
                minLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm font-mono uppercase tracking-widest"
                placeholder="8 characters"
              />
            </label>
          )}
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
            disabled={working}
            className="w-full h-11 rounded-full bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {working
              ? mode === "create"
                ? "Creating…"
                : "Joining…"
              : mode === "create"
                ? "Create workspace"
                : "Join workspace"}
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
