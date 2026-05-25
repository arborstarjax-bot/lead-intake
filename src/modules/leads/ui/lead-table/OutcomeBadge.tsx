"use client";

import type { OutcomeBadge as OutcomeBadgeType } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

const BADGE_STYLES: Record<OutcomeBadgeType, { bg: string; fg: string; border: string }> = {
  "Sold":                        { bg: "bg-green-50",   fg: "text-green-700",  border: "border-green-200" },
  "Not Sold":                    { bg: "bg-rose-50",    fg: "text-rose-700",   border: "border-rose-200" },
  "Needs Follow-Up":             { bg: "bg-blue-50",    fg: "text-blue-700",   border: "border-blue-200" },
  "No Proposal Sent":            { bg: "bg-amber-50",   fg: "text-amber-700",  border: "border-amber-200" },
  "Not Within Scope":            { bg: "bg-slate-100",  fg: "text-slate-600",  border: "border-slate-300" },
  "Did Not Meet Minimum":        { bg: "bg-orange-50",  fg: "text-orange-700", border: "border-orange-200" },
  "Proposal Revision Requested": { bg: "bg-violet-50",  fg: "text-violet-700", border: "border-violet-200" },
  "Waiting on Decision":         { bg: "bg-cyan-50",    fg: "text-cyan-700",   border: "border-cyan-200" },
  "Requested Callback":          { bg: "bg-indigo-50",  fg: "text-indigo-700", border: "border-indigo-200" },
};

export function OutcomeBadge({ badge }: { badge: OutcomeBadgeType }) {
  const style = BADGE_STYLES[badge];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 h-6 text-[11px] font-semibold whitespace-nowrap",
        style.bg, style.fg, style.border
      )}
    >
      {badge}
    </span>
  );
}
