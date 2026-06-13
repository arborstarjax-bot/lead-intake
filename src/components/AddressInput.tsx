"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadGoogleMaps } from "@/modules/routing";

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
 * When the user selects a prediction, `onSelect` fires with parsed
 * street / city / state / zip so the parent can fill sibling fields.
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
  const [mapsReady, setMapsReady] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async (g) => {
        await g.maps.importLibrary("places");
        if (!cancelled) setMapsReady(true);
      })
      .catch((err) => {
        console.warn("[AddressInput] Maps unavailable:", err);
      });
    return () => {
      cancelled = true;
    };
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
          sessionTokenRef.current =
            new google.maps.places.AutocompleteSessionToken();
        }
        const service = new google.maps.places.AutocompleteService();
        const preds =
          await new Promise<google.maps.places.AutocompletePrediction[]>(
            (resolve, reject) => {
              service.getPlacePredictions(
                {
                  input,
                  componentRestrictions: { country: "us" },
                  types: ["address"],
                  sessionToken: sessionTokenRef.current ?? undefined,
                },
                (results, status) => {
                  if (
                    status === google.maps.places.PlacesServiceStatus.OK &&
                    results
                  ) {
                    resolve(results);
                  } else if (
                    status ===
                    google.maps.places.PlacesServiceStatus.ZERO_RESULTS
                  ) {
                    resolve([]);
                  } else {
                    reject(new Error(`Places API error: ${status}`));
                  }
                }
              );
            }
          );
        const items: Prediction[] = preds.slice(0, 5).map((p) => ({
          placeId: p.place_id,
          description: p.description,
          mainText: p.structured_formatting?.main_text ?? p.description,
          secondaryText: p.structured_formatting?.secondary_text ?? "",
        }));
        setPredictions(items);
        if (items.length > 0) setOpen(true);
      } catch (err) {
        console.warn("[AddressInput] prediction error:", err);
        setPredictions([]);
      }
    },
    [mapsReady]
  );

  function onInputChange(val: string) {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 300);
  }

  async function selectPrediction(pred: Prediction) {
    setOpen(false);
    onChange(pred.mainText);

    try {
      const service = new google.maps.places.PlacesService(
        document.createElement("div")
      );
      const details =
        await new Promise<google.maps.places.PlaceResult | null>((resolve) => {
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
        });
      sessionTokenRef.current = null;

      if (!details?.address_components) {
        onSelectRef.current({
          street: pred.mainText,
          city: "",
          state: "",
          zip: "",
        });
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
      const state =
        get("administrative_area_level_1")?.short_name ?? "";
      const zip = get("postal_code")?.long_name ?? "";

      const finalStreet = street || pred.mainText;
      onChange(finalStreet);
      onSelectRef.current({ street: finalStreet, city, state, zip });
    } catch {
      onSelectRef.current({
        street: pred.mainText,
        city: "",
        state: "",
        zip: "",
      });
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
