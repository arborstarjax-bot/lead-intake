"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

export function ReorderArrows({
  canUp,
  canDown,
  onUp,
  onDown,
  disabled,
}: {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onUp}
        disabled={!canUp || disabled}
        aria-label="Move up"
        className="h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] inline-flex items-center justify-center active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        onClick={onDown}
        disabled={!canDown || disabled}
        aria-label="Move down"
        className="h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] inline-flex items-center justify-center active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ArrowDown className="h-4 w-4" />
      </button>
    </div>
  );
}
