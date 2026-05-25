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
      <>
        <FillBar fill={1} />
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-red-100 text-red-700 font-semibold">
          full
        </span>
      </>
    );
  }
  const cost = preview.bestTotalDriveMinutes ?? null;
  const effective = preview.effectiveBestMinutes ?? null;
  const isBest = best != null && effective != null && effective === best;
  const clustered = preview.clusterBonusMinutes > 0;

  // Fill bar: more slots = less full. Max ~6 stops = full.
  const maxSlots = 8;
  const fill = Math.max(0, Math.min(1, 1 - preview.slotCount / maxSlots));

  return (
    <>
      <FillBar fill={fill} />
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
    </>
  );
}

function FillBar({ fill }: { fill: number }) {
  const color =
    fill >= 0.8
      ? "bg-red-400"
      : fill >= 0.5
        ? "bg-amber-400"
        : "bg-emerald-400";
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-xl overflow-hidden bg-gray-100">
      <div
        className={cn("h-full rounded-b-xl transition-all", color)}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </div>
  );
}
