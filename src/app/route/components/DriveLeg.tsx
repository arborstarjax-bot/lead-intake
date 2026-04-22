"use client";

import { Car } from "lucide-react";

export function DriveLeg({ minutes }: { minutes: number }) {
  return (
    <div className="pl-[13px] ml-px border-l border-dashed border-[var(--border)] h-6 flex items-center">
      <span className="ml-4 text-[11px] text-[var(--muted)] inline-flex items-center gap-1">
        <Car className="h-3 w-3" /> {minutes} min
      </span>
    </div>
  );
}
