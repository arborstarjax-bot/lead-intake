"use client";

import { Sparkles } from "lucide-react";
import { LEAD_SOURCES, type Lead, type LeadPatch, type LeadSource } from "@/modules/leads/model";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";

const SOURCE_STYLES: Record<string, { bg: string; fg: string; border: string }> = {
  Facebook:              { bg: "bg-blue-50",    fg: "text-blue-700",    border: "border-blue-200" },
  Craigslist:            { bg: "bg-violet-50",  fg: "text-violet-700",  border: "border-violet-200" },
  Instagram:             { bg: "bg-pink-50",    fg: "text-pink-700",    border: "border-pink-200" },
  "Close AI":            { bg: "bg-yellow-50",  fg: "text-yellow-700",  border: "border-yellow-200" },
  "Certified Lead Kings":{ bg: "bg-emerald-50", fg: "text-emerald-700", border: "border-emerald-200" },
  "Text Message":        { bg: "bg-teal-50",    fg: "text-teal-700",   border: "border-teal-200" },
  "Google Ads":          { bg: "bg-green-50",   fg: "text-green-700",  border: "border-green-200" },
  "Website Form":        { bg: "bg-slate-50",   fg: "text-slate-600",  border: "border-slate-200" },
  Nextdoor:              { bg: "bg-lime-50",    fg: "text-lime-700",   border: "border-lime-200" },
  Thumbtack:             { bg: "bg-orange-50",  fg: "text-orange-700", border: "border-orange-200" },
  Angi:                  { bg: "bg-red-50",     fg: "text-red-700",    border: "border-red-200" },
  Email:                 { bg: "bg-sky-50",     fg: "text-sky-700",    border: "border-sky-200" },
  Referral:              { bg: "bg-indigo-50",  fg: "text-indigo-700", border: "border-indigo-200" },
  "Tree Letter":         { bg: "bg-amber-50",   fg: "text-amber-700",  border: "border-amber-200" },
  "Direct Mail":         { bg: "bg-cyan-50",    fg: "text-cyan-700",   border: "border-cyan-200" },
  Other:                 { bg: "bg-gray-50",    fg: "text-gray-600",   border: "border-gray-200" },
};

const DEFAULT_STYLE = { bg: "bg-gray-50", fg: "text-gray-600", border: "border-gray-200" };

export function LeadSourceBadge({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (p: LeadPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const source = lead.lead_source;
  const conf = lead.extraction_confidence?.lead_source;
  const isAI = typeof conf === "number" && conf > 0;
  const style = source ? (SOURCE_STYLES[source] ?? DEFAULT_STYLE) : DEFAULT_STYLE;

  if (!source) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold border border-dashed border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--border-strong)] transition"
        >
          + Source
        </button>
        {open && (
          <SourceDropdown
            onSelect={(s) => {
              onPatch({ lead_source: s });
              setOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold border transition",
          style.bg, style.fg, style.border
        )}
      >
        {source}
        {isAI && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-[var(--brand-bright)] uppercase tracking-wider">
            <Sparkles className="h-2.5 w-2.5" />
            AI
          </span>
        )}
      </button>
      {open && (
        <SourceDropdown
          current={source}
          onSelect={(s) => {
            onPatch({
              lead_source: s,
              extraction_confidence_merge: { lead_source: null },
            });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SourceDropdown({
  current,
  onSelect,
}: {
  current?: LeadSource | null;
  onSelect: (s: LeadSource) => void;
}) {
  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-48 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-white shadow-lg py-1">
      {LEAD_SOURCES.map((s) => {
        const style = SOURCE_STYLES[s] ?? DEFAULT_STYLE;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] transition",
              current === s && "font-semibold"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full", style.bg, style.border, "border")} />
            {s}
          </button>
        );
      })}
    </div>
  );
}
