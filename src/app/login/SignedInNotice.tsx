"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "./actions";

export function SignedInNotice({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await logout();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-amber-50 text-amber-900 text-sm px-3 py-2">
        You&apos;re signed in as <span className="font-medium">{email}</span>,
        but you&apos;re not a member of any workspace yet. Sign out to use a
        different account, or join one with a code.
      </div>
      <Link
        href="/workspace"
        className="block w-full h-11 rounded-full bg-[var(--accent)] text-white text-sm font-semibold inline-flex items-center justify-center"
      >
        Join a workspace
      </Link>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="w-full h-11 rounded-full border border-[var(--border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
