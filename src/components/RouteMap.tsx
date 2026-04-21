"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export type RouteMapStop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  startTime: string;
};

export type RouteMapHome = {
  address: string;
  lat: number;
  lng: number;
};

export type RouteMapMode = "pins" | "route";

type Props = {
  home: RouteMapHome | null;
  stops: RouteMapStop[];
  mode: RouteMapMode;
  /** If set, a faint "ghost" pin + dashed line is drawn to preview how a
   *  prospective slot (not yet booked) would fit into the day. */
  ghost?: RouteMapStop | null;
};

function formatClock(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

export default function RouteMap({ home, stops, mode, ghost }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const directionsRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One-shot: load Google Maps and instantiate the map inside the container.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return;
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 30.3322, lng: -81.6557 }, // Jacksonville fallback
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // Reduce POI noise so the route stands out.
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        infoWindowRef.current = new google.maps.InfoWindow();
        setStatus("ready");
      })
      .catch((e: Error) => {
        setStatus("error");
        setErrorMessage(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render overlays whenever stops/home/mode/ghost change.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const google = window.google;
    const map = mapRef.current;

    // Tear down previous overlays.
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    for (const p of polylinesRef.current) p.setMap(null);
    polylinesRef.current = [];
    if (directionsRef.current) {
      directionsRef.current.setMap(null);
      directionsRef.current = null;
    }

    const bounds = new google.maps.LatLngBounds();
    let anyPoint = false;

    // Home marker — distinct color + letter H.
    if (home) {
      const marker = new google.maps.Marker({
        position: { lat: home.lat, lng: home.lng },
        map,
        label: { text: "H", color: "#fff", fontSize: "12px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#0f766e",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: `Home · ${home.address}`,
      });
      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(
          `<div style="font-size:12px"><strong>Home</strong><br/>${escapeHtml(home.address)}</div>`
        );
        infoWindowRef.current?.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      anyPoint = true;
    }

    // Numbered stop markers.
    stops.forEach((s, i) => {
      const marker = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map,
        label: {
          text: String(i + 1),
          color: "#fff",
          fontSize: "12px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: `${s.label} · ${formatClock(s.startTime)}`,
      });
      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(
          `<div style="font-size:12px"><strong>${escapeHtml(s.label)}</strong><br/>${formatClock(
            s.startTime
          )}<br/>${escapeHtml(s.address)}</div>`
        );
        infoWindowRef.current?.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      anyPoint = true;
    });

    // Ghost marker — faded amber, no number. Shown when previewing a slot.
    if (ghost) {
      const marker = new google.maps.Marker({
        position: { lat: ghost.lat, lng: ghost.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#f59e0b",
          fillOpacity: 0.7,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: `${ghost.label} (preview) · ${formatClock(ghost.startTime)}`,
      });
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      anyPoint = true;
    }

    // Draw connectors: either straight polylines (fast + free) or the
    // actual driving route via DirectionsService.
    if (mode === "pins") {
      drawStraightPolylines({ google, map, home, stops, ghost, polylinesRef });
    } else if (mode === "route" && stops.length > 0) {
      drawDirections({ google, map, home, stops, directionsRef }).catch(() => {
        // Fall back to straight lines if Directions fails (quota, no route
        // between points, etc.). The map shouldn't go blank.
        drawStraightPolylines({ google, map, home, stops, ghost, polylinesRef });
      });
    }

    if (anyPoint) {
      if (markersRef.current.length === 1) {
        map.setCenter(markersRef.current[0].getPosition()!);
        map.setZoom(13);
      } else {
        map.fitBounds(bounds, 64);
      }
    }
  }, [status, home, stops, mode, ghost]);

  return (
    <div className="relative w-full h-[60vh] min-h-[320px] rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
      <div ref={containerRef} className="absolute inset-0" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)] gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-md">
            {errorMessage ?? "Couldn't load Google Maps."}
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function drawStraightPolylines({
  google,
  map,
  home,
  stops,
  ghost,
  polylinesRef,
}: {
  google: typeof window.google;
  map: google.maps.Map;
  home: RouteMapHome | null;
  stops: RouteMapStop[];
  ghost: RouteMapStop | null | undefined;
  polylinesRef: React.MutableRefObject<google.maps.Polyline[]>;
}) {
  const path: google.maps.LatLngLiteral[] = [];
  if (home) path.push({ lat: home.lat, lng: home.lng });
  for (const s of stops) path.push({ lat: s.lat, lng: s.lng });
  if (home && stops.length > 0) path.push({ lat: home.lat, lng: home.lng });

  if (path.length >= 2) {
    const line = new google.maps.Polyline({
      path,
      map,
      strokeColor: "#2563eb",
      strokeOpacity: 0.8,
      strokeWeight: 3,
    });
    polylinesRef.current.push(line);
  }

  // Ghost connector: dashed line from home to the ghost slot.
  if (ghost && home) {
    const dashed = new google.maps.Polyline({
      path: [
        { lat: home.lat, lng: home.lng },
        { lat: ghost.lat, lng: ghost.lng },
      ],
      map,
      strokeOpacity: 0,
      icons: [
        {
          icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
          offset: "0",
          repeat: "10px",
        },
      ],
    });
    polylinesRef.current.push(dashed);
  }
}

async function drawDirections({
  google,
  map,
  home,
  stops,
  directionsRef,
}: {
  google: typeof window.google;
  map: google.maps.Map;
  home: RouteMapHome | null;
  stops: RouteMapStop[];
  directionsRef: React.MutableRefObject<google.maps.DirectionsRenderer | null>;
}) {
  // Build origin/destination: prefer the home-to-home round trip; if there's
  // no home set, go from stop 1 to stop N with intermediates.
  if (stops.length === 0) return;

  const service = new google.maps.DirectionsService();
  const renderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true, // keep our numbered markers, don't overlay A/B
    polylineOptions: {
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 4,
    },
  });
  directionsRef.current = renderer;

  let origin: google.maps.LatLngLiteral;
  let destination: google.maps.LatLngLiteral;
  let waypoints: google.maps.DirectionsWaypoint[];
  if (home) {
    origin = { lat: home.lat, lng: home.lng };
    destination = { lat: home.lat, lng: home.lng };
    waypoints = stops.map((s) => ({
      location: { lat: s.lat, lng: s.lng },
      stopover: true,
    }));
  } else {
    origin = { lat: stops[0].lat, lng: stops[0].lng };
    destination = { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng };
    waypoints = stops.slice(1, -1).map((s) => ({
      location: { lat: s.lat, lng: s.lng },
      stopover: true,
    }));
  }

  const result = await service.route({
    origin,
    destination,
    waypoints,
    // Keep the user's chronological order — optimizeWaypoints=true would
    // reorder, which contradicts the scheduled times shown on the pins.
    optimizeWaypoints: false,
    travelMode: google.maps.TravelMode.DRIVING,
  });
  renderer.setDirections(result);
}
