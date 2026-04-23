"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  pendingCount,
  replayQueue,
  type ReplaySummary,
} from "@/lib/offline-queue";
import { useToast } from "@/components/Toast";

/**
 * Drives the IndexedDB offline write queue.
 *
 * Replay triggers:
 *   1. `online` window event — the obvious one.
 *   2. `visibilitychange` → visible — iOS Safari doesn't always fire
 *      `online` in standalone PWAs; coming back to the foreground is a
 *      reliable fallback.
 *   3. Periodic interval — final safety net so a user who leaves the tab
 *      foregrounded across a reconnect still gets replay without
 *      touching anything.
 *   4. Mount — replay any leftovers from a previous session before the
 *      user does anything else.
 *
 * Shows a toast when items land and calls router.refresh() so server
 * components (lead lists, calendars) pull the just-landed state.
 *
 * Idempotent: if a replay is already running we no-op. Throws are
 * swallowed — a failing queue shouldn't wedge the app.
 */
export function OfflineQueueReplayer() {
  const router = useRouter();
  const { toast } = useToast();
  const running = useRef(false);

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function run() {
      // Claim the guard synchronously BEFORE any await, otherwise two
      // triggers firing near-simultaneously (e.g. online + visibilitychange
      // when a mobile PWA returns to foreground) can both pass the check
      // before either sets it and we'd replay every queued write twice.
      if (running.current) return;
      running.current = true;
      let summary: ReplaySummary | null = null;
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          return;
        }
        const pending = await pendingCount().catch(() => 0);
        if (pending === 0) return;
        try {
          summary = await replayQueue();
        } catch {
          summary = null;
        }
      } finally {
        running.current = false;
      }
      if (!mounted || !summary) return;

      // Two independent toasts: a single run can both land writes AND
      // drop others (replayQueue continues past a 4xx max-attempts drop).
      // Hiding the drop behind an `else if` would let permanently-lost
      // edits disappear silently under a success message.
      if (summary.replayed > 0) {
        toast({
          kind: "success",
          message:
            summary.replayed === 1
              ? "Synced 1 offline change"
              : `Synced ${summary.replayed} offline changes`,
        });
        // Refresh server-rendered lists so the just-replayed writes are
        // reflected (lead card status, scheduled time, etc).
        router.refresh();
      }
      if (summary.dropped > 0) {
        toast({
          kind: "error",
          message:
            summary.dropped === 1
              ? "1 offline change failed and was dropped"
              : `${summary.dropped} offline changes failed and were dropped`,
        });
      }
      if (summary.authRequired) {
        // Distinct from the "dropped" toast: the queue is intact, it
        // just needs a signed-in session to drain. Previously 401s
        // burned through the 3-attempt 4xx budget and silently
        // dropped the user's work.
        toast({
          kind: "error",
          message:
            summary.remaining === 1
              ? "Sign in again to sync 1 offline change"
              : `Sign in again to sync ${summary.remaining} offline changes`,
          action: {
            label: "Sign in",
            onClick: () => {
              router.push("/login");
            },
          },
        });
      }
    }

    // Initial attempt after mount.
    void run();

    const onOnline = () => {
      void run();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    // Lightweight poll — 60s is plenty since the event triggers above
    // cover the common cases.
    interval = setInterval(() => {
      void run();
    }, 60_000);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (interval) clearInterval(interval);
    };
  }, [router, toast]);

  return null;
}
