"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, Info, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
};

type ToastAPI = {
  /** Push a new toast. Returns the id so callers can dismiss early. */
  toast: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
};

const ToastCtx = createContext<ToastAPI | null>(null);

/**
 * App-wide toast stack. Replaces native `alert()` / `confirm()` with
 * non-modal toasts that match the existing "Marked Completed · Undo"
 * pattern. Mount once at the root of the tree.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastAPI["toast"]>(
    (t) => {
      const id = `t-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const duration = t.duration ?? 4000;
      setToasts((prev) => [...prev, { ...t, id }]);
      const handle = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, handle);
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const snapshot = timers.current;
    return () => {
      snapshot.forEach((t) => clearTimeout(t));
      snapshot.clear();
    };
  }, []);

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <ToastPill
            key={t.id}
            toast={t}
            onAction={() => {
              t.action?.onClick();
              dismiss(t.id);
            }}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Provider not mounted — fall back to console so the caller never crashes.
    return {
      toast: (t) => {
        console.warn("[toast]", t.kind, t.message);
        return "";
      },
      dismiss: () => {},
    };
  }
  return ctx;
}

function ToastPill({
  toast,
  onAction,
  onDismiss,
}: {
  toast: Toast;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const icon =
    toast.kind === "error" ? (
      <AlertTriangle className="h-4 w-4 text-red-300" />
    ) : toast.kind === "info" ? (
      <Info className="h-4 w-4 text-sky-300" />
    ) : (
      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
    );
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2.5 shadow-lg text-sm max-w-[92vw]",
        "bg-[var(--fg)] text-white"
      )}
    >
      {icon}
      <span className="truncate">{toast.message}</span>
      {toast.action && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 underline font-medium"
        >
          <Undo2 className="h-4 w-4" />
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 -mr-1 text-white/60 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
