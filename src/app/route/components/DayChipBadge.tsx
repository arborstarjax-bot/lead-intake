"use client";

import { cn } from "@/lib/utils";
import type { DayPreview } from "../route-helpers";

export function DayChipBadge({
  preview,
  best,
}: {
  preview: DayPreview;
  best: number | null;
}) {
  if (!preview.isWorkDay) {
    return (
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-gray-100 text-gray-500">
        off
      </span>
    );
  }
  if (preview.slotCount === 0) {
    return (
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-red-100 text-red-700">
        full
      </span>
    );
  }
  const cost = preview.bestTotalDriveMinutes ?? null;
  const effective = preview.effectiveBestMinutes ?? null;
  const isBest = best != null && effective != null && effective === best;
  const clustered = preview.clusterBonusMinutes > 0;
  return (
    <span
      className={cn(
        "absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded whitespace-nowrap inline-flex items-center gap-0.5",
        isBest
          ? "bg-emerald-600 text-white"
          : "bg-emerald-50 text-emerald-800"
      )}
      title={
        clustered
          ? `${preview.clusterBonusMinutes}m cluster bonus — already working this area`
          : undefined
      }
    >
      {cost != null ? `+${cost}m` : "ok"}
      {clustered && (
        <span aria-hidden className="text-[8px] leading-none">
          •
        </span>
      )}
    </span>
  );
}
