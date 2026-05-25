"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Home, Landmark, ChevronDown } from "lucide-react";
import { LEAD_TYPES, type Lead, type LeadPatch, type LeadType } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

const TYPE_STYLES: Record<LeadType, { bg: string; fg: string; border: string }> = {
  Residential:  { bg: "bg-sky-50",    fg: "text-sky-700",    border: "border-sky-200" },
  Commercial:   { bg: "bg-amber-50",  fg: "text-amber-700",  border: "border-amber-200" },
  Government:   { bg: "bg-slate-100", fg: "text-slate-700",  border: "border-slate-300" },
};

const TYPE_ICONS: Record<LeadType, typeof Home> = {
  Residential: Home,
  Commercial: Building2,
  Government: Landmark,
};

export function LeadTypePill({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (p: LeadPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = lead.lead_type;

  if (!current) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2.5 h-7 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
        >
          + Type
        </button>
        {open && (
          <DropdownMenu
            onSelect={(t) => {
              onPatch({ lead_type: t });
              setOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  const style = TYPE_STYLES[current];
  const Icon = TYPE_ICONS[current];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-[11px] font-semibold transition",
          style.bg, style.fg, style.border
        )}
      >
        <Icon className="h-3 w-3" />
        {current}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
      {open && (
        <DropdownMenu
          selected={current}
          onSelect={(t) => {
            onPatch({ lead_type: t === current ? null : t });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DropdownMenu({
  selected,
  onSelect,
}: {
  selected?: LeadType;
  onSelect: (t: LeadType) => void;
}) {
  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-44 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
      {LEAD_TYPES.map((t) => {
        const s = TYPE_STYLES[t];
        const Icon = TYPE_ICONS[t];
        return (
          <button
            key={t}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(t);
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-[var(--surface-2)] transition",
              selected === t && "bg-[var(--surface-2)] font-semibold"
            )}
          >
            <span className={cn("flex items-center justify-center w-5 h-5 rounded-full", s.bg)}>
              <Icon className={cn("h-3 w-3", s.fg)} />
            </span>
            {t}
          </button>
        );
      })}
    </div>
  );
}
