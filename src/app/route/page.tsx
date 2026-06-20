"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarCheck,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RouteMap, type RouteMapMode, type RouteMapStop, type RouteMapFlexStop } from "@/modules/routing";
import { LEAD_FLEX_WINDOW_DISPLAY } from "@/modules/leads/model";
import {
  addDaysIso,
  formatDateLong,
  todayEtIso,
  type RouteResponse,
  type Slot,
} from "./route-helpers";
import { DayActions } from "./components/DayActions";
import { DayPicker } from "./components/DayPicker";
import { EstimatesList } from "./components/EstimatesList";
import { ModeToggle } from "./components/ModeToggle";
import { SchedulePanel } from "./components/SchedulePanel";


export default function RoutePage() {
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <RoutePageInner />
    </Suspense>
  );
}

function RouteSkeleton() {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
      <div className="mt-6 h-64 rounded-2xl bg-gray-100 animate-pulse" />
    </main>
  );
}

function RoutePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const scheduleLeadId = params.get("scheduleLead");
  const dayParam = params.get("day");

  const todayIso = useMemo(() => todayEtIso(), []);
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDaysIso(todayIso, i)),
    [todayIso]
  );

  // Day selection. When we arrive with ?scheduleLead, we don't know the
  // right default until the first /route fetch returns the ghost (and its
  // desiredDay). `desiredDayApplied` makes sure we only pivot once so the
  // user can still tap other chips freely afterward.
  const [selectedDay, setSelectedDay] = useState<string>(dayParam ?? todayIso);
  const desiredDayApplied = useRef(false);

  const [mode, setMode] = useState<RouteMapMode>("route");
  const [data, setData] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Currently-previewed scheduling slot. Tapping a slot in SchedulePanel
  // sets this; it drives the amber preview directions overlay on the map
  // and only commits to Google/DB when the user explicitly confirms.
  const [previewSlot, setPreviewSlot] = useState<Slot | null>(null);

  // Drop any active preview whenever the context changes (day switched,
  // schedule closed, different lead). The map's own deps array already
  // reacts to these, but dropping the selection explicitly keeps
  // SchedulePanel's UI state in sync.
  useEffect(() => {
    setPreviewSlot(null);
  }, [selectedDay, scheduleLeadId]);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 3_000);
  }

  const load = useCallback(
    async (iso: string, ghostId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ date: iso });
        if (ghostId) qs.set("ghost", ghostId);
        const res = await fetch(`/api/schedule/route?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Failed (${res.status})`);
          setData(null);
          return null as RouteResponse | null;
        }
        setData(json as RouteResponse);
        return json as RouteResponse;
      } catch (e) {
        setError((e as Error).message || "Network error");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch whenever the day or the ghost lead changes.
  useEffect(() => {
    let cancelled = false;
    load(selectedDay, scheduleLeadId).then((resp) => {
      if (cancelled || !resp) return;
      // First load after arrival with ?scheduleLead: if the lead had a
      // scheduled_day of its own AND the caller didn't pin a specific `day`,
      // pivot the picker to that day so the ranking matches the customer's
      // preference.
      if (
        !desiredDayApplied.current &&
        scheduleLeadId &&
        !dayParam &&
        resp.ghost?.desiredDay &&
        resp.ghost.desiredDay >= todayIso &&
        resp.ghost.desiredDay !== selectedDay
      ) {
        desiredDayApplied.current = true;
        setSelectedDay(resp.ghost.desiredDay);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, scheduleLeadId, dayParam, load, todayIso]);

  const ghostForMap: RouteMapStop | null = useMemo(() => {
    if (!data?.ghost) return null;
    return {
      id: data.ghost.id,
      label: data.ghost.label,
      address: data.ghost.address,
      lat: data.ghost.lat,
      lng: data.ghost.lng,
      // Map doesn't show a time badge on the ghost pin; empty string is fine.
      startTime: "",
    };
  }, [data]);

  const flexForMap: RouteMapFlexStop[] = useMemo(() => {
    if (!data?.flexStops?.length) return [];
    return data.flexStops.map((fs) => ({
      id: fs.id,
      label: fs.label,
      address: fs.address,
      lat: fs.lat,
      lng: fs.lng,
      flexLabel: LEAD_FLEX_WINDOW_DISPLAY[fs.flexWindow],
    }));
  }, [data]);

  const reload = useCallback(() => {
    load(selectedDay, scheduleLeadId);
  }, [load, selectedDay, scheduleLeadId]);

  const totalDrive = data?.totalDriveMinutes ?? null;
  // Stop count in the page header includes flex leads so a day with
  // only flex bookings doesn't read as "No jobs scheduled".
  const stopCount =
    (data?.stops.length ?? 0) + (data?.flexStops?.length ?? 0);



  return (
    <main
      className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6"
      style={{ paddingBottom: 128 }}
    >
      <PageHeader title="Schedule" />

          <DayPicker
            days={days}
            todayIso={todayIso}
            selected={selectedDay}
            onSelect={setSelectedDay}
            scheduleLeadId={scheduleLeadId}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">{formatDateLong(selectedDay)}</div>
              <div className="text-xs text-[var(--muted)] mt-0.5">
                {loading
                  ? "Loading…"
                  : stopCount === 0
                    ? "No jobs scheduled"
                    : stopCount === 1
                      ? "1 job"
                      : `${stopCount} jobs`}
                {totalDrive != null && stopCount > 0 && ` · ${totalDrive} min driving`}
              </div>
            </div>
            <ModeToggle mode={mode} setMode={setMode} />
          </div>

          {error && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <RouteMap
            home={data?.home ?? null}
            stops={data?.stops ?? []}
            flexStops={flexForMap}
            mode={mode}
            ghost={ghostForMap}
            previewStopTime={previewSlot?.startTime ?? null}
          />

          {data && data.unresolved.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                Couldn&apos;t pin{" "}
                {data.unresolved.length === 1
                  ? "1 stop"
                  : `${data.unresolved.length} stops`}{" "}
                — Google didn&apos;t recognize the address.
                <ul className="mt-1 space-y-0.5">
                  {data.unresolved.map((u) => (
                    <li key={u.id}>
                      <span className="font-medium">{u.label}</span>{" "}
                      <span className="text-amber-700">· {u.address}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {data && (
            <DayActions
              data={data}
              onSynced={(msg) => {
                showFlash(msg);
                reload();
              }}
              onUnbook={() => reload()}
            />
          )}

          {data && (data.stops.length > 0 || (data.flexStops?.length ?? 0) > 0) && (
            <EstimatesList data={data} onReload={reload} onFlash={showFlash} />
          )}

          {scheduleLeadId && data?.ghost && (
            <SchedulePanel
              leadId={scheduleLeadId}
              leadLabel={data.ghost.label}
              leadUpdatedAt={data.ghost.updatedAt}
              selectedDay={selectedDay}
              previewSlot={previewSlot}
              routeData={data}
              onPreview={setPreviewSlot}
              onReload={reload}
              onSelectDay={(day) => {
                setPreviewSlot(null);
                setSelectedDay(day);
                router.replace(`/route?scheduleLead=${scheduleLeadId}&day=${day}`, {
                  scroll: false,
                });
              }}
              onBooked={(msg) => {
                showFlash(msg);
                setPreviewSlot(null);
                router.replace(`/route?day=${selectedDay}`, { scroll: false });
                reload();
              }}
              onClose={() => {
                setPreviewSlot(null);
                router.replace(`/route?day=${selectedDay}`, { scroll: false });
              }}
            />
          )}

      {flash && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-6 z-50 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--accent)] text-white px-4 py-2.5 shadow-lg text-sm">
            <CalendarCheck className="h-4 w-4" />
            {flash}
          </div>
        </div>
      )}
    </main>
  );
}
