"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Car,
  Clock,
  Home,
  MapPin,
  AlertTriangle,
  X,
  Sparkles,
  Loader2,
  CalendarCheck,
  CalendarPlus,
  MoreVertical,
  RefreshCw,
  Trash2,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import RouteMap, { type RouteMapMode, type RouteMapStop } from "@/components/RouteMap";
import { cn } from "@/lib/utils";

type Stop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  startTime: string;
  endTime: string;
  driveMinutesFromPrev: number | null;
  firstName: string | null;
  phoneNumber: string | null;
};

type Ghost = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  desiredDay: string | null;
  currentTime: string | null;
};

type RouteResponse = {
  date: string;
  home: { lat: number; lng: number; address: string } | null;
  stops: Stop[];
  unresolved: { id: string; label: string; address: string }[];
  totalDriveMinutes: number | null;
  returnDriveMinutes: number | null;
  ghost: Ghost | null;
  ghostError: string | null;
};

type Half = "all" | "morning" | "afternoon";

type Slot = {
  startTime: string;
  endTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
};

type DayPreview =
  | {
      date: string;
      isWorkDay: true;
      bestTotalDriveMinutes: number | null;
      slotCount: number;
    }
  | { date: string; isWorkDay: false };

/** Pure ET-safe YYYY-MM-DD math. Adds n days to the given iso date. */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + n);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

/** Today in America/New_York, YYYY-MM-DD. Matches the server-side helper. */
function todayEtIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatClock(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function dayChipLabel(iso: string, todayIso: string): { top: string; bottom: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (iso === todayIso) return { top: "Today", bottom: String(dt.getUTCDate()) };
  if (iso === addDaysIso(todayIso, 1))
    return { top: "Tmrw", bottom: String(dt.getUTCDate()) };
  const weekday = dt.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
  return { top: weekday, bottom: String(dt.getUTCDate()) };
}

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

  const closeScheduler = useCallback(() => {
    router.replace("/route", { scroll: false });
  }, [router]);

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

  const reload = useCallback(() => {
    load(selectedDay, scheduleLeadId);
  }, [load, selectedDay, scheduleLeadId]);

  const totalDrive = data?.totalDriveMinutes ?? null;
  const stopCount = data?.stops.length ?? 0;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5 pb-32">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Route Map</h1>
        <div className="w-9" />
      </header>

      {scheduleLeadId && (
        <SchedulingBanner
          ghost={data?.ghost ?? null}
          ghostError={data?.ghostError ?? null}
          onClose={closeScheduler}
        />
      )}

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
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <RouteMap
        home={data?.home ?? null}
        stops={data?.stops ?? []}
        mode={mode}
        ghost={ghostForMap}
        previewStopTime={previewSlot?.startTime ?? null}
      />

      {data && data.unresolved.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
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

      {data && data.stops.length > 0 && (
        <StopList data={data} onReload={reload} onFlash={showFlash} />
      )}

      {scheduleLeadId && data?.ghost && (
        <SchedulePanel
          leadId={scheduleLeadId}
          leadLabel={data.ghost.label}
          selectedDay={selectedDay}
          previewSlot={previewSlot}
          onPreview={setPreviewSlot}
          onBooked={(msg) => {
            showFlash(msg);
            setPreviewSlot(null);
            // After booking we clear the ghost param — the newly booked
            // lead becomes a regular numbered pin on reload.
            router.replace(`/route?day=${selectedDay}`, { scroll: false });
            reload();
          }}
        />
      )}

      {flash && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--accent)] text-white px-4 py-2.5 shadow-lg text-sm">
            <CalendarCheck className="h-4 w-4" />
            {flash}
          </div>
        </div>
      )}
    </main>
  );
}

function SchedulingBanner({
  ghost,
  ghostError,
  onClose,
}: {
  ghost: Ghost | null;
  ghostError: string | null;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <Sparkles className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
          AI Schedule
        </div>
        <div className="font-semibold truncate">
          {ghost?.label ?? "Scheduling lead"}
        </div>
        <div className="text-xs text-amber-800/80 truncate">
          {ghostError
            ? ghostError
            : ghost
              ? ghost.address
              : "Loading preview…"}
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close scheduling"
        className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full text-amber-800 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function DayPicker({
  days,
  todayIso,
  selected,
  onSelect,
  scheduleLeadId,
}: {
  days: string[];
  todayIso: string;
  selected: string;
  onSelect: (iso: string) => void;
  scheduleLeadId: string | null;
}) {
  // When scheduling, fetch the week preview so each day chip gets a drive-
  // cost badge (same data the old modal used).
  const [week, setWeek] = useState<Map<string, DayPreview> | null>(null);
  useEffect(() => {
    if (!scheduleLeadId) {
      setWeek(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/schedule/week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: scheduleLeadId }),
        });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const map = new Map<string, DayPreview>();
        for (const d of (json.days ?? []) as DayPreview[]) map.set(d.date, d);
        setWeek(map);
      } catch {
        // Silent — chips just render without cost pills.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleLeadId]);

  const bestMinutes = useMemo(() => {
    if (!week) return null;
    const costs: number[] = [];
    for (const d of week.values()) {
      if (d.isWorkDay && d.bestTotalDriveMinutes != null)
        costs.push(d.bestTotalDriveMinutes);
    }
    return costs.length ? Math.min(...costs) : null;
  }, [week]);

  return (
    <nav
      aria-label="Pick a day"
      className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar"
    >
      <div className="inline-flex gap-2 px-4 sm:px-0">
        {days.map((iso) => {
          const { top, bottom } = dayChipLabel(iso, todayIso);
          const active = iso === selected;
          const preview = week?.get(iso);
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className={cn(
                "relative flex flex-col items-center justify-center shrink-0 w-[64px] h-[64px] rounded-xl border transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-gray-50"
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wider">
                {top}
              </span>
              <span className="text-lg font-semibold leading-none mt-0.5">
                {bottom}
              </span>
              {preview && <DayChipBadge preview={preview} best={bestMinutes} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function DayChipBadge({
  preview,
  best,
}: {
  preview: DayPreview;
  best: number | null;
}) {
  if (!preview.isWorkDay) {
    return (
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-gray-100 text-gray-500">
        off
      </span>
    );
  }
  if (preview.slotCount === 0) {
    return (
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-red-100 text-red-700">
        full
      </span>
    );
  }
  const cost = preview.bestTotalDriveMinutes ?? null;
  const isBest = best != null && cost != null && cost === best;
  return (
    <span
      className={cn(
        "absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded whitespace-nowrap",
        isBest
          ? "bg-emerald-600 text-white"
          : "bg-emerald-50 text-emerald-800"
      )}
    >
      {cost != null ? `+${cost}m` : "ok"}
    </span>
  );
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: RouteMapMode;
  setMode: (m: RouteMapMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Map mode"
      className="inline-flex rounded-full border border-[var(--border)] bg-white p-0.5 text-xs"
    >
      {(["pins", "route"] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            "px-3 h-8 rounded-full font-medium",
            mode === m
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          )}
        >
          {m === "pins" ? "Pins" : "Route"}
        </button>
      ))}
    </div>
  );
}

function DayActions({
  data,
  onSynced,
  onUnbook,
}: {
  data: RouteResponse;
  onSynced: (msg: string) => void;
  onUnbook: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suppress onUnbook warning — reserved for future inline actions that
  // need a reload hook (the current timeline menu handles its own reload
  // via onReload).
  void onUnbook;

  const needsSyncCount = useMemo(() => {
    // We don't get per-lead sync state from /route; fall back to always
    // offering the button when there are stops. The endpoint itself no-ops
    // for already-synced events.
    return data.stops.length;
  }, [data.stops.length]);

  async function syncDay() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/sync-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: data.date }),
      });
      const json = await res.json();
      if (res.status === 428) {
        if (confirm("Google Calendar is not connected. Connect now?")) {
          window.location.href = json.connectUrl;
        }
        return;
      }
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        return;
      }
      const s = json.summary as {
        total: number;
        created: number;
        updated: number;
        already: number;
        errors: number;
      };
      const parts: string[] = [];
      if (s.created) parts.push(`${s.created} added`);
      if (s.updated) parts.push(`${s.updated} updated`);
      if (s.already && !parts.length) parts.push("already in sync");
      if (s.errors) parts.push(`${s.errors} failed`);
      onSynced(`Calendar: ${parts.join(", ") || "done"}`);
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setSyncing(false);
    }
  }

  if (needsSyncCount === 0) return null;

  return (
    <div className="relative flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
      <div className="min-w-0 text-sm">
        <div className="font-medium">Save day to calendar</div>
        <div className="text-xs text-[var(--muted)]">
          Push all {data.stops.length} stop{data.stops.length === 1 ? "" : "s"} to Google Calendar in one tap.
        </div>
      </div>
      <button
        onClick={syncDay}
        disabled={syncing}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-3 h-10 text-sm font-medium bg-[var(--accent)] text-white active:scale-[0.98] transition",
          syncing && "opacity-70"
        )}
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CalendarPlus className="h-4 w-4" />
        )}
        {syncing ? "Saving…" : "Save day"}
      </button>
      {error && (
        <div className="absolute right-4 mt-14 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}

function StopList({
  data,
  onReload,
  onFlash,
}: {
  data: RouteResponse;
  onReload: () => void;
  onFlash: (msg: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1 mb-3">
        <Car className="h-3.5 w-3.5" /> Timeline
      </div>
      <ol className="space-y-0">
        {data.home && (
          <TimelineRow
            kind="home"
            index={null}
            title="Home"
            subtitle={data.home.address}
          />
        )}
        {data.stops.map((s, i) => (
          <div key={s.id}>
            {s.driveMinutesFromPrev != null && (
              <DriveLeg minutes={s.driveMinutesFromPrev} />
            )}
            <TimelineRow
              kind="stop"
              index={i + 1}
              title={s.label}
              subtitle={
                <>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatClock(s.startTime)}
                  </span>
                  <span className="mx-1.5 text-[var(--border)]">·</span>
                  <span className="truncate">{s.address}</span>
                </>
              }
              action={
                <StopMenu
                  leadId={s.id}
                  label={s.label}
                  firstName={s.firstName}
                  phoneNumber={s.phoneNumber}
                  startTime={s.startTime}
                  date={data.date}
                  onReload={onReload}
                  onFlash={onFlash}
                />
              }
            />
          </div>
        ))}
        {data.home && data.returnDriveMinutes != null && data.stops.length > 0 && (
          <>
            <DriveLeg minutes={data.returnDriveMinutes} />
            <TimelineRow
              kind="home"
              index={null}
              title="Home"
              subtitle="End of day"
            />
          </>
        )}
      </ol>
    </div>
  );
}

function TimelineRow({
  kind,
  index,
  title,
  subtitle,
  action,
}: {
  kind: "home" | "stop";
  index: number | null;
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <div
        className={cn(
          "shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full text-[11px] font-semibold",
          kind === "home"
            ? "bg-teal-600 text-white"
            : "bg-[var(--accent)] text-white"
        )}
      >
        {kind === "home" ? <Home className="h-3.5 w-3.5" /> : (index ?? <MapPin className="h-3.5 w-3.5" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-[var(--muted)] truncate">{subtitle}</div>
      </div>
      {action}
    </li>
  );
}

function DriveLeg({ minutes }: { minutes: number }) {
  return (
    <div className="pl-[13px] ml-px border-l border-dashed border-[var(--border)] h-6 flex items-center">
      <span className="ml-4 text-[11px] text-[var(--muted)] inline-flex items-center gap-1">
        <Car className="h-3 w-3" /> {minutes} min
      </span>
    </div>
  );
}

function StopMenu({
  leadId,
  label,
  firstName,
  phoneNumber,
  startTime,
  date,
  onReload,
  onFlash,
}: {
  leadId: string;
  label: string;
  firstName: string | null;
  phoneNumber: string | null;
  startTime: string;
  date: string;
  onReload: () => void;
  onFlash: (msg: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  async function cancel() {
    if (!confirm(`Unbook ${label}? This removes it from the calendar and moves it back to Called.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/calendar`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? `Failed (${res.status})`);
        return;
      }
      onFlash(`Unbooked ${label}`);
      onReload();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  function reschedule() {
    setOpen(false);
    router.push(`/route?scheduleLead=${leadId}&day=${date}`);
  }

  const smsHref = useMemo(() => {
    if (!phoneNumber) return null;
    const who = firstName?.trim() || "there";
    const day = formatDateLong(date);
    const when = `${day} at ${formatClock(startTime)}`;
    const body = `Hi ${who}, David with Arbor Tech 904. Confirming our arborist assessment on ${when}. Reply here if anything changes — see you then!`;
    const digits = phoneNumber.replace(/[^\d+]/g, "");
    // `?` (RFC 5724) is the only separator Android accepts — `&` gets
    // absorbed into the phone-number portion so the prefilled body drops.
    // iOS accepts both, so `?` is safe on iPhone too.
    return `sms:${digits}?body=${encodeURIComponent(body)}`;
  }, [firstName, phoneNumber, date, startTime]);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Stop actions"
        className="inline-flex items-center justify-center h-8 w-8 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-10 w-48 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
          {smsHref && (
            <a
              href={smsHref}
              onClick={() => setOpen(false)}
              className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)]"
            >
              <MessageSquare className="h-4 w-4" /> Text confirmation
            </a>
          )}
          <button
            onClick={reschedule}
            disabled={busy}
            className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)]"
          >
            <RefreshCw className="h-4 w-4" /> Reschedule
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}

function SchedulePanel({
  leadId,
  leadLabel,
  selectedDay,
  previewSlot,
  onPreview,
  onBooked,
}: {
  leadId: string;
  leadLabel: string;
  selectedDay: string;
  previewSlot: Slot | null;
  onPreview: (slot: Slot | null) => void;
  onBooked: (msg: string) => void;
}) {
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, half, day: selectedDay }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        setSlots([]);
        setWarnings([]);
        return;
      }
      setSlots(json.slots ?? []);
      setWarnings(json.warnings ?? []);
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [leadId, half, selectedDay]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // Drop any preview when the half-day filter changes. Otherwise the
  // "Confirm & book 2:00 PM" bar would still sit under a list that no
  // longer includes that slot (e.g. filtered to AM) and the map would
  // keep drawing the stale amber overlay.
  useEffect(() => {
    onPreview(null);
    // Intentionally only reacting to `half`. onPreview is a stable setter
    // and including it would clear the preview on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [half]);

  async function book() {
    if (!previewSlot) return;
    setBooking(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_time: previewSlot.startTime,
          scheduled_day: selectedDay,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(patchJson.error ?? "Failed to set time");
      }
      const calRes = await fetch(`/api/leads/${leadId}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (calRes.status === 428) {
        if (confirm("Google Calendar is not connected. Connect now?")) {
          window.location.href = calJson.connectUrl;
        }
        return;
      }
      if (!calRes.ok) throw new Error(calJson.error ?? "Calendar sync failed");
      onBooked(`Booked ${leadLabel} at ${formatClock(previewSlot.startTime)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-white shadow-2xl rounded-t-2xl">
      <div className="mx-auto max-w-6xl px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> Ranked slots
            </div>
            <div className="font-semibold truncate">
              {formatDateLong(selectedDay)}
            </div>
          </div>
          <HalfTabs half={half} setHalf={setHalf} />
        </div>

        {warnings.length > 0 && !loading && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {warnings.join(" · ")}
          </div>
        )}

        {error && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6 flex items-center justify-center text-[var(--muted)] text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Ranking slots…
          </div>
        ) : slots.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            No feasible slots on this day.
          </div>
        ) : (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {slots.map((s) => {
              const selected = previewSlot?.startTime === s.startTime;
              return (
                <button
                  key={s.startTime}
                  onClick={() => onPreview(selected ? null : s)}
                  disabled={booking}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                    selected
                      ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
                      : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{formatClock(s.startTime)}</div>
                    <div className="text-xs text-[var(--muted)] truncate">
                      {[s.reasoning.priorLabel, s.reasoning.nextLabel]
                        .filter(Boolean)
                        .join(" · ") || "Open slot"}
                      {" · "}
                      {s.totalDriveMinutes} min driving
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 transition",
                      selected
                        ? "text-amber-600 rotate-90"
                        : "text-[var(--muted)]"
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}

        {previewSlot && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onPreview(null)}
              disabled={booking}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={book}
              disabled={booking}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {booking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Booking…
                </>
              ) : (
                <>
                  <CalendarCheck className="h-4 w-4" />
                  Confirm &amp; book {formatClock(previewSlot.startTime)}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HalfTabs({
  half,
  setHalf,
}: {
  half: Half;
  setHalf: (h: Half) => void;
}) {
  const tabs: { id: Half; label: string }[] = [
    { id: "morning", label: "AM" },
    { id: "afternoon", label: "PM" },
    { id: "all", label: "All" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Half of day"
      className="inline-flex rounded-full border border-[var(--border)] bg-white p-0.5 text-xs shrink-0"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={half === t.id}
          onClick={() => setHalf(t.id)}
          className={cn(
            "px-3 h-8 rounded-full font-medium",
            half === t.id
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
