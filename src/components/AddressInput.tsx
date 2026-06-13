"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

type Prediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type AddressParts = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Generic address input with Google Places autocomplete.
 * Uses a server-side proxy (/api/places/*) so no browser-side
 * Google Maps API key is required — the server key handles it.
 */
export function AddressInput({
  value,
  onChange,
  onSelect,
  placeholder = "123 Main St",
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (parts: AddressParts) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
      console.warn("[AddressInput] prediction error:", err);
      setPredictions([]);
    }
  }, []);

  function onInputChange(val: string) {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 300);
  }

  async function selectPrediction(pred: Prediction) {
    setOpen(false);
    onChange(pred.mainText);

    try {
      const res = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(pred.placeId)}`
      );
      if (!res.ok) {
        onSelectRef.current({ street: pred.mainText, city: "", state: "", zip: "" });
        return;
      }
      const data = await res.json();
      if (data.parts) {
        const street = data.parts.street || pred.mainText;
        onChange(street);
        onSelectRef.current({
          street,
          city: data.parts.city ?? "",
          state: data.parts.state ?? "",
          zip: data.parts.zip ?? "",
        });
      } else {
        onSelectRef.current({ street: pred.mainText, city: "", state: "", zip: "" });
      }
    } catch {
      onSelectRef.current({ street: pred.mainText, city: "", state: "", zip: "" });
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => {
            if (predictions.length > 0) setOpen(true);
          }}
          className={cn(className, "w-full pr-8")}
          autoComplete="off"
          autoFocus={autoFocus}
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
