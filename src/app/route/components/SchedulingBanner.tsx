"use client";

import { AlertTriangle, X } from "lucide-react";
import type { Ghost } from "../route-helpers";

export function SchedulingBanner({
  ghost,
  ghostError,
  onClose,
}: {
  ghost: Ghost | null;
  ghostError: string | null;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-amber-900">
          Scheduling {ghost ? ghost.label : "…"}
        </div>
        <div className="text-xs text-amber-800/80 truncate">
          {ghostError
            ? ghostError
            : ghost
              ? ghost.address
              : "Loading preview…"}
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close scheduling"
        className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full text-amber-800 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
