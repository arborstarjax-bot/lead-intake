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
  /** If set, a faint amber "ghost" pin is drawn to preview a prospective
   *  slot (not yet booked). */
  ghost?: RouteMapStop | null;
  /** When a slot time is being previewed, the ghost is inserted chronologically
   *  into the day's stops. Only the new leg (into the ghost) is drawn in amber
   *  so the user can see exactly which segment is changing; the rest of the
   *  day stays blue. When null, the regular blue route renders. */
  previewStopTime?: string | null;
};

const ROUTE_COLOR = "#2563eb";
const HIGHLIGHT_COLOR = "#f59e0b";
const DIMMED_COLOR = "#94a3b8";
// House silhouette centered at (0, 0) tip-anchored on the base so it plants
// on the exact marker position. Dimensions tuned for ~28 px rendered height.
const HOUSE_PATH =
  "M -11 2 L 0 -10 L 11 2 L 11 13 L 3 13 L 3 6 L -3 6 L -3 13 L -11 13 Z";

function formatClock(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

export default function RouteMap({
  home,
  stops,
  mode,
  ghost,
  previewStopTime,
}: Props) {
  const previewing = Boolean(ghost && previewStopTime);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const legPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  // Monotonic draw id. Incremented before every Directions request. The
  // async draw bails out if its id is no longer current, which prevents
  // stale polylines from a previous `stops`/`ghost` render landing on the
  // map after the next render has already torn down `legPolylinesRef`.
  const drawIdRef = useRef(0);
  // Preview metadata shared between the main (draw) effect and the cheap
  // recolor effect. Keeping it in a ref means recolor doesn't need to
  // recompute `insertedStops` and we don't add `ghost`/`previewStopTime`
  // to the recolor effect's dep array.
  const previewLegIndexRef = useRef(-1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Selected leg index. A leg[i] is the polyline landing on stop i+1 (so
  // leg 0 is Home → Stop 1, leg N-1 is Stop N-1 → Stop N, and leg N is
  // the return Stop N → Home). Null = nothing selected, all legs default-
  // colored.
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null);

  // One-shot: load Google Maps and instantiate the map inside the container.
  useEffect(() => {
    let cancelled = false;
    const onAuthFailure = () => {
      if (cancelled) return;
      setStatus("error");
      setErrorMessage(
        window.__googleMapsAuthError ?? "Google rejected the Maps API key."
      );
    };
    window.addEventListener("googleMapsAuthFailure", onAuthFailure);
    if (window.__googleMapsAuthError) onAuthFailure();
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) return;
        if (window.__googleMapsAuthError) return;
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 30.3322, lng: -81.6557 }, // Jacksonville fallback
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        infoWindowRef.current = new google.maps.InfoWindow();
        // Tapping anywhere on the base map clears a selected leg so the
        // route returns to its unselected (all-blue) state.
        map.addListener("click", () => setSelectedLeg(null));
        setStatus("ready");
      })
      .catch((e: Error) => {
        setStatus("error");
        setErrorMessage(e.message);
      });
    return () => {
      cancelled = true;
      window.removeEventListener("googleMapsAuthFailure", onAuthFailure);
    };
  }, []);

  // Reset selection whenever the underlying stops list or the ghost state
  // changes, since the leg indices the selection refers to become stale.
  useEffect(() => {
    setSelectedLeg(null);
  }, [stops, ghost, previewStopTime]);

  // Compute the intended stroke color for a given leg index. Pure
  // function of the current render's selection + preview state; used by
  // both the initial draw and the cheap recolor effect.
  const computeLegColor = (
    legIdx: number,
    previewingNow: boolean,
    previewLegIndex: number,
    selected: number | null
  ): string => {
    if (previewingNow) {
      return legIdx === previewLegIndex ? HIGHLIGHT_COLOR : DIMMED_COLOR;
    }
    if (selected == null) return ROUTE_COLOR;
    return legIdx === selected ? HIGHLIGHT_COLOR : DIMMED_COLOR;
  };

  // Re-render overlays whenever stops/home/mode/ghost change. Notably
  // NOT dependent on `selectedLeg` — leg clicks should be cheap recolors,
  // not full Directions API round-trips. Selection is applied in a
  // separate effect below.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const google = window.google;
    const map = mapRef.current;

    // Bump the draw id so any in-flight `drawPerLegDirections` call from
    // a previous render bails out when it resolves.
    const drawId = ++drawIdRef.current;

    // Tear down previous overlays.
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    for (const p of legPolylinesRef.current) p.setMap(null);
    legPolylinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let anyPoint = false;

    // Home marker — house-shaped pin rather than the old circle-with-H. The
    // path is tip-anchored at (0, 0) so it sits cleanly on the home address.
    if (home) {
      const marker = new google.maps.Marker({
        position: { lat: home.lat, lng: home.lng },
        map,
        icon: {
          path: HOUSE_PATH,
          scale: 1.1,
          fillColor: "#0f766e",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
          anchor: new google.maps.Point(0, 13),
        },
        title: `Home · ${home.address}`,
        zIndex: 1000,
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

    // Numbered stop markers. Clicking a pin highlights the leg that ends
    // at that stop (so stop i+1 highlights leg i). Tapping the map
    // background clears the selection.
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
          fillColor: ROUTE_COLOR,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: `${s.label} · ${formatClock(s.startTime)}`,
      });
      marker.addListener("click", () => {
        // stopPropagation — the map click listener would otherwise
        // immediately null-out the selection we just set.
        setSelectedLeg(i);
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
    // The only route color change in preview mode is the single leg that
    // would feed into the ghost; the rest of the day stays blue.
    if (ghost) {
      const marker = new google.maps.Marker({
        position: { lat: ghost.lat, lng: ghost.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: HIGHLIGHT_COLOR,
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

    // Route mode: draw one polyline per leg so individual legs can be
    // recolored without redrawing the whole route. When previewing a new
    // pin, insert the ghost chronologically and highlight only the inbound
    // leg in amber; confirmed legs stay blue so the user sees exactly the
    // new segment being added.
    if (mode === "route" && stops.length > 0) {
      const insertedStops: RouteMapStop[] = previewing && ghost && previewStopTime
        ? [...stops, { ...ghost, startTime: previewStopTime }].sort((a, b) =>
            a.startTime.localeCompare(b.startTime)
          )
        : stops;
      const previewLegIndex =
        previewing && ghost
          ? insertedStops.findIndex((s) => s.id === ghost.id)
          : -1;
      previewLegIndexRef.current = previewLegIndex;
      drawPerLegDirections({
        google,
        map,
        home,
        stops: insertedStops,
        legPolylinesRef,
        // selectedLeg is read at draw-time only; subsequent changes are
        // handled by the recolor effect without another Directions call.
        // The reset-on-stops-change effect above also nulls selection
        // whenever this effect fires, so `selectedLeg` should be null here
        // unless the caller intentionally set it after a mount.
        getLegColor: (legIdx) =>
          computeLegColor(legIdx, previewing, previewLegIndex, selectedLeg),
        onLegClick: (legIdx) => {
          // Clicking a leg polyline selects it too — matches the expected
          // behavior of "tap a line, it highlights."
          if (!previewing) setSelectedLeg(legIdx);
        },
        drawId,
        isCurrent: () => drawIdRef.current === drawId,
      }).catch(() => {
        // Directions can fail (quota, no route, etc.). Markers are already
        // on the map; fall through to pins-only.
      });
    } else {
      previewLegIndexRef.current = -1;
    }

    if (anyPoint) {
      if (markersRef.current.length === 1) {
        map.setCenter(markersRef.current[0].getPosition()!);
        map.setZoom(13);
      } else {
        map.fitBounds(bounds, 64);
      }
    }
    // NOTE: `selectedLeg` is intentionally omitted from deps — see the
    // recolor effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, home, stops, mode, ghost, previewStopTime, previewing]);

  // Cheap recolor pass. Updates existing polyline stroke colors in place
  // when `selectedLeg` changes — no Directions API call, no marker rebuild,
  // no viewport reset. This is what was previously happening on every
  // click before this effect was split out.
  useEffect(() => {
    if (status !== "ready") return;
    const polylines = legPolylinesRef.current;
    for (let i = 0; i < polylines.length; i++) {
      const color = computeLegColor(
        i,
        previewing,
        previewLegIndexRef.current,
        selectedLeg
      );
      polylines[i].setOptions({ strokeColor: color });
    }
    // `previewing` is a dep so flipping into/out of preview mode also
    // recolors correctly; `previewLegIndexRef` is a ref so it doesn't
    // need to be declared here.
  }, [selectedLeg, previewing, status]);

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

/**
 * Build the day's directions in a single DirectionsService call, then
 * render each leg as its own Polyline so we can recolor one without
 * touching the others. Google returns N legs for (N+1) waypoints (home
 * counts as 0 and N+1 when round-tripping), which maps 1:1 to our leg
 * indices used elsewhere in the component.
 */
async function drawPerLegDirections({
  google,
  map,
  home,
  stops,
  legPolylinesRef,
  getLegColor,
  onLegClick,
  drawId,
  isCurrent,
}: {
  google: typeof window.google;
  map: google.maps.Map;
  home: RouteMapHome | null;
  stops: RouteMapStop[];
  legPolylinesRef: React.MutableRefObject<google.maps.Polyline[]>;
  getLegColor: (legIdx: number) => string;
  onLegClick: (legIdx: number) => void;
  /** Monotonic id captured when this call was kicked off; used with
   *  `isCurrent` to drop stale results so overlapping Directions requests
   *  can't push polylines into a ref that has already been torn down. */
  drawId: number;
  isCurrent: () => boolean;
}) {
  void drawId;
  if (stops.length === 0) return;

  const service = new google.maps.DirectionsService();
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
    optimizeWaypoints: false,
    travelMode: google.maps.TravelMode.DRIVING,
  });

  // If the component re-rendered with new stops/ghost while this request
  // was in flight, legPolylinesRef has already been torn down and reset.
  // Bail out so we don't push stale polylines onto the map.
  if (!isCurrent()) return;

  const route = result.routes[0];
  if (!route) return;

  route.legs.forEach((leg, legIdx) => {
    const polyline = new google.maps.Polyline({
      map,
      path: leg.steps.flatMap((step) => step.path ?? []),
      strokeColor: getLegColor(legIdx),
      strokeOpacity: 0.9,
      strokeWeight: 5,
      clickable: true,
      zIndex: legIdx === -1 ? 0 : 10,
    });
    polyline.addListener("click", () => onLegClick(legIdx));
    legPolylinesRef.current.push(polyline);
  });
}
