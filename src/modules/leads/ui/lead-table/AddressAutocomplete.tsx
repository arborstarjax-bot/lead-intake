"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Lead, LeadPatch } from "@/modules/leads/model";
import { cn } from "@/lib/utils";
import { loadGoogleMaps } from "@/modules/routing/client/maps-loader";

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
  const [mapsReady, setMapsReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const focused = useRef(false);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  useEffect(() => {
    if (!focused.current) setQuery(lead.address ?? "");
  }, [lead.address]);

  useEffect(() => {
    loadGoogleMaps()
      .then(async (g) => {
        await g.maps.importLibrary("places");
        setMapsReady(true);
      })
      .catch(() => {
        /* Maps unavailable — fall back to plain input */
      });
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const fetchPredictions = useCallback(
    async (input: string) => {
      if (!mapsReady || !input.trim()) {
        setPredictions([]);
        return;
      }
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }
        const service = new google.maps.places.AutocompleteService();
        const res = await service.getPlacePredictions({
          input,
          componentRestrictions: { country: "us" },
          types: ["address"],
          sessionToken: sessionTokenRef.current,
        });
        const items: Prediction[] = (res.predictions ?? []).slice(0, 5).map((p) => ({
          placeId: p.place_id,
          description: p.description,
          mainText: p.structured_formatting?.main_text ?? p.description,
          secondaryText: p.structured_formatting?.secondary_text ?? "",
        }));
        setPredictions(items);
        if (items.length > 0) setOpen(true);
      } catch {
        setPredictions([]);
      }
    },
    [mapsReady]
  );

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
      const service = new google.maps.places.PlacesService(
        document.createElement("div")
      );
      const details = await new Promise<google.maps.places.PlaceResult | null>(
        (resolve) => {
          service.getDetails(
            {
              placeId: pred.placeId,
              fields: ["address_components", "formatted_address"],
              sessionToken: sessionTokenRef.current ?? undefined,
            },
            (result, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK) {
                resolve(result);
              } else {
                resolve(null);
              }
            }
          );
        }
      );
      sessionTokenRef.current = null;

      if (!details?.address_components) {
        onPatchRef.current({ address: pred.mainText });
        return;
      }

      const components = details.address_components;
      const get = (type: string) =>
        components.find((c) => c.types.includes(type));

      const streetNumber = get("street_number")?.long_name ?? "";
      const route = get("route")?.long_name ?? "";
      const street = [streetNumber, route].filter(Boolean).join(" ");
      const city =
        get("locality")?.long_name ??
        get("sublocality_level_1")?.long_name ??
        "";
      const state = get("administrative_area_level_1")?.short_name ?? "";
      const zip = get("postal_code")?.long_name ?? "";

      const patch: LeadPatch = { address: street || pred.mainText };
      if (city) patch.city = city;
      if (state) patch.state = state;
      if (zip) patch.zip = zip;
      onPatchRef.current(patch);
      setQuery(street || pred.mainText);
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
        {mapsReady && (
          <MapPin className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--subtle)] pointer-events-none" />
        )}
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
