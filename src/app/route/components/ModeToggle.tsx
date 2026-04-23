"use client";

import type { RouteMapMode } from "@/modules/routing";
import { cn } from "@/lib/utils";

export function ModeToggle({
  mode,
  setMode,
}: {
  mode: RouteMapMode;
  setMode: (m: RouteMapMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Map mode"
      className="inline-flex rounded-full border border-[var(--border)] bg-white p-0.5 text-xs"
    >
      {(["pins", "route"] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            "px-3 h-8 rounded-full font-medium",
            mode === m
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          )}
        >
          {m === "pins" ? "Pins" : "Route"}
        </button>
      ))}
    </div>
  );
}
