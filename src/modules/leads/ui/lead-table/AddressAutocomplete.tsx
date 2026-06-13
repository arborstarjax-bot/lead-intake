"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Lead, LeadPatch } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

type Prediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export function AddressAutocomplete({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (p: LeadPatch) => void;
}) {
  const [query, setQuery] = useState(lead.address ?? "");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  useEffect(() => {
    if (!focused.current) setQuery(lead.address ?? "");
  }, [lead.address]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input.trim()) {
      setPredictions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/places/autocomplete?input=${encodeURIComponent(input)}`
      );
      if (!res.ok) {
        setPredictions([]);
        return;
      }
      const data = await res.json();
      const items: Prediction[] = data.predictions ?? [];
      setPredictions(items);
      if (items.length > 0) setOpen(true);
    } catch (err) {
      console.warn("[AddressAutocomplete] prediction error:", err);
      setPredictions([]);
    }
  }, []);

  function onInputChange(value: string) {
    setQuery(value);
    focused.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(value), 300);
  }

  async function selectPrediction(pred: Prediction) {
    setOpen(false);
    setQuery(pred.mainText);

    try {
      const res = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(pred.placeId)}`
      );
      if (!res.ok) {
        onPatchRef.current({ address: pred.mainText });
        return;
      }
      const data = await res.json();
      if (data.parts) {
        const street = data.parts.street || pred.mainText;
        const patch: LeadPatch = { address: street };
        if (data.parts.city) patch.city = data.parts.city;
        if (data.parts.state) patch.state = data.parts.state;
        if (data.parts.zip) patch.zip = data.parts.zip;
        onPatchRef.current(patch);
        setQuery(street);
      } else {
        onPatchRef.current({ address: pred.mainText });
      }
    } catch {
      onPatchRef.current({ address: pred.mainText });
    }
  }

  function onBlur() {
    focused.current = false;
    const trimmed = query.trim();
    const current = (lead.address ?? "").trim();
    if (trimmed !== current) {
      const patch: LeadPatch = {
        address: trimmed || null,
      };
      const currentConf = lead.extraction_confidence?.address;
      if (typeof currentConf === "number" && currentConf > 0) {
        patch.extraction_confidence_merge = { address: null };
      }
      onPatchRef.current(patch);
    }
  }

  const conf = lead.extraction_confidence?.address;
  const lowConf =
    typeof conf === "number" && conf > 0 && conf < 0.6 && Boolean(query);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          placeholder="Street address"
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => {
            focused.current = true;
            if (predictions.length > 0) setOpen(true);
          }}
          onBlur={onBlur}
          className={cn("field-input w-full pr-8", lowConf && "invalid-soft")}
          title={lowConf ? `Low confidence (${Math.round((conf ?? 0) * 100)}%)` : undefined}
          autoComplete="off"
        />
        <MapPin className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--subtle)] pointer-events-none" />
      </div>
      {open && predictions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-xl shadow-lg overflow-hidden">
          {predictions.map((pred) => (
            <button
              key={pred.placeId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectPrediction(pred);
              }}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--surface-2)] transition"
            >
              <MapPin className="h-4 w-4 text-[var(--muted)] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--fg)] truncate">
                  {pred.mainText}
                </div>
                {pred.secondaryText && (
                  <div className="text-xs text-[var(--muted)] truncate">
                    {pred.secondaryText}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
