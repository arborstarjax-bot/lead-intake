"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Car, Clock, Home, MapPin, AlertTriangle } from "lucide-react";
import RouteMap, { type RouteMapMode } from "@/components/RouteMap";
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
};

type RouteResponse = {
  date: string;
  home: { lat: number; lng: number; address: string } | null;
  stops: Stop[];
  unresolved: { id: string; label: string; address: string }[];
  totalDriveMinutes: number | null;
  returnDriveMinutes: number | null;
};

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
  const todayIso = useMemo(() => todayEtIso(), []);
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDaysIso(todayIso, i)),
    [todayIso]
  );

  const [selectedDay, setSelectedDay] = useState<string>(todayIso);
  const [mode, setMode] = useState<RouteMapMode>("route");
  const [data, setData] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (iso: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/route?date=${iso}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        setData(null);
      } else {
        setData(json as RouteResponse);
      }
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDay);
  }, [selectedDay, load]);

  const totalDrive = data?.totalDriveMinutes ?? null;
  const stopCount = data?.stops.length ?? 0;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
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

      <DayPicker
        days={days}
        todayIso={todayIso}
        selected={selectedDay}
        onSelect={setSelectedDay}
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

      <RouteMap home={data?.home ?? null} stops={data?.stops ?? []} mode={mode} />

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

      {data && data.stops.length > 0 && (
        <StopList data={data} />
      )}
    </main>
  );
}

function DayPicker({
  days,
  todayIso,
  selected,
  onSelect,
}: {
  days: string[];
  todayIso: string;
  selected: string;
  onSelect: (iso: string) => void;
}) {
  return (
    <nav
      aria-label="Pick a day"
      className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar"
    >
      <div className="inline-flex gap-2 px-4 sm:px-0">
        {days.map((iso) => {
          const { top, bottom } = dayChipLabel(iso, todayIso);
          const active = iso === selected;
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className={cn(
                "flex flex-col items-center justify-center shrink-0 w-[64px] h-[64px] rounded-xl border transition-colors",
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
            </button>
          );
        })}
      </div>
    </nav>
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

function StopList({ data }: { data: RouteResponse }) {
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
}: {
  kind: "home" | "stop";
  index: number | null;
  title: string;
  subtitle: React.ReactNode;
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
      <div className="min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-[var(--muted)] truncate">{subtitle}</div>
      </div>
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
