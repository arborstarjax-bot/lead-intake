import { Check, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export function SaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-white/95 backdrop-blur",
        "px-4 py-3 sm:px-6"
      )}
    >
      <div className="mx-auto max-w-2xl flex items-center gap-2">
        <button
          type="button"
          onClick={onRevert}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-11 text-sm font-medium disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
          Revert
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] text-white h-11 text-sm font-semibold disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : dirty ? (
            <>
              <Check className="h-4 w-4" /> Save changes
            </>
          ) : (
            <>All changes saved</>
          )}
        </button>
      </div>
    </div>
  );
}
