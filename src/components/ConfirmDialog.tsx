"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true the confirm button renders red; use for deletes/unbooks. */
  destructive?: boolean;
};

type ConfirmAPI = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmAPI | null>(null);

type Pending = {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
};

/**
 * In-app replacement for `window.confirm()`. Renders a centered modal
 * with a title, optional body, and two buttons. Calls to `confirm(…)`
 * return a promise that resolves `true` / `false`.
 *
 * Mount once at the root — `useConfirm()` returns the async confirm
 * function.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback<ConfirmAPI>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          // If a dialog is already pending and a second call comes in
          // (e.g. two concurrent API responses both need a confirm),
          // auto-cancel the first so its caller's `finally` still runs
          // and the UI doesn't freeze in a busy/disabled state.
          prev?.resolve(false);
          return { opts, resolve };
        });
      }),
    []
  );

  const settle = useCallback(
    (value: boolean) => {
      setPending((prev) => {
        prev?.resolve(value);
        return null;
      });
    },
    []
  );

  // Close on Escape, confirm on Enter. Dialog traps focus via autoFocus on
  // the confirm button + inert content behind via the fixed backdrop.
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      } else if (
        e.key === "Enter" &&
        (document.activeElement === confirmBtnRef.current ||
          document.activeElement === document.body)
      ) {
        // Only act on Enter when focus is on the confirm button (the
        // default after mount) or has escaped to <body>. If the user
        // Tab'd onto Cancel, let its native Enter handling run so they
        // can actually cancel.
        e.preventDefault();
        settle(true);
      }
    }
    window.addEventListener("keydown", onKey);
    confirmBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {pending ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            // Tap outside = cancel. Same as clicking Cancel.
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[var(--border)] overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                {pending.opts.destructive ? (
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                ) : null}
                <div className="flex-1 space-y-1">
                  <h2 id="confirm-title" className="text-base font-semibold">
                    {pending.opts.title}
                  </h2>
                  {pending.opts.message ? (
                    <p className="text-sm text-[var(--muted)]">
                      {pending.opts.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 p-3 bg-[var(--surface-2)] border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => settle(false)}
                className="inline-flex items-center justify-center h-11 flex-1 rounded-full border border-[var(--border)] bg-white text-sm font-medium text-[var(--fg)]"
              >
                {pending.opts.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => settle(true)}
                className={cn(
                  "inline-flex items-center justify-center h-11 flex-1 rounded-full text-sm font-semibold text-white",
                  pending.opts.destructive
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                )}
              >
                {pending.opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmCtx.Provider>
  );
}

/**
 * Returns an async confirm function. Resolves `true` when the user
 * accepts, `false` when they cancel (or dismiss via Escape / backdrop
 * tap). Falls back to `window.confirm` if the provider isn't mounted
 * so callers never crash.
 */
export function useConfirm(): ConfirmAPI {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    return async ({ title, message }) =>
      typeof window !== "undefined"
        ? window.confirm(message ? `${title}\n\n${message}` : title)
        : false;
  }
  return ctx;
}
