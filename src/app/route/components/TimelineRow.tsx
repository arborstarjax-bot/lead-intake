"use client";

import React from "react";
import { Home, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export function TimelineRow({
  kind,
  index,
  title,
  subtitle,
  action,
}: {
  kind: "home" | "stop";
  index: number | null;
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <div
        className={cn(
          "shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full text-[11px] font-semibold",
          kind === "home"
            ? "bg-teal-600 text-white"
            : "bg-[var(--accent)] text-white"
        )}
      >
        {kind === "home" ? <Home className="h-3.5 w-3.5" /> : (index ?? <MapPin className="h-3.5 w-3.5" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-[var(--muted)] truncate">{subtitle}</div>
      </div>
      {action}
    </li>
  );
}
