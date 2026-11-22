"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { type Lead, type LeadPatch } from "@/modules/leads/model";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";

const STYLE_POOL = [
  { bg: "bg-emerald-50", fg: "text-emerald-700", border: "border-emerald-200" },
  { bg: "bg-indigo-50",  fg: "text-indigo-700",  border: "border-indigo-200" },
  { bg: "bg-orange-50",  fg: "text-orange-700",  border: "border-orange-200" },
  { bg: "bg-teal-50",    fg: "text-teal-700",    border: "border-teal-200" },
  { bg: "bg-rose-50",    fg: "text-rose-700",    border: "border-rose-200" },
  { bg: "bg-violet-50",  fg: "text-violet-700",  border: "border-violet-200" },
];

function styleFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return STYLE_POOL[Math.abs(hash) % STYLE_POOL.length];
}

export function LeadJobTypePill({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (p: LeadPatch) => void;
}) {
  const { settings } = useAppSettings();
  const types = settings.job_types;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = lead.job_type;

  if (!current) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2.5 h-7 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
        >
          + Job Type
        </button>
        {open && (
          <JobTypeDropdown
            types={types}
            onSelect={(t) => {
              onPatch({ job_type: t });
              setOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  const style = styleFor(current);

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
        <Wrench className="h-3 w-3" />
        {current}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
      {open && (
        <JobTypeDropdown
          types={types}
          selected={current}
          onSelect={(t) => {
            onPatch({ job_type: t === current ? null : t });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function JobTypeDropdown({
  types,
  selected,
  onSelect,
}: {
  types: string[];
  selected?: string | null;
  onSelect: (t: string) => void;
}) {
  const list = types.filter((t) => t.trim().length > 0);
  if (list.length === 0) {
    return (
      <div className="absolute left-0 top-full mt-1 z-40 w-44 rounded-xl border border-[var(--border)] bg-white shadow-lg px-3 py-2.5 text-sm text-[var(--muted)]">
        No job types configured.
      </div>
    );
  }
  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-44 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
      <div className="max-h-56 overflow-y-auto">
        {list.map((t) => {
        const s = styleFor(t);
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
              <Wrench className={cn("h-3 w-3", s.fg)} />
            </span>
            {t}
          </button>
        );
        })}
      </div>
    </div>
  );
}
