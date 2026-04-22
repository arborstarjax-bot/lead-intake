"use client";

import { cn } from "@/lib/utils";
import type { Half } from "../route-helpers";

export function HalfTabs({
  half,
  setHalf,
}: {
  half: Half;
  setHalf: (h: Half) => void;
}) {
  const tabs: { id: Half; label: string }[] = [
    { id: "morning", label: "AM" },
    { id: "afternoon", label: "PM" },
    { id: "all", label: "All" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Half of day"
      className="inline-flex rounded-full border border-[var(--border)] bg-white p-0.5 text-xs shrink-0"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={half === t.id}
          onClick={() => setHalf(t.id)}
          className={cn(
            "px-3 h-8 rounded-full font-medium",
            half === t.id
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
