"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Home, Car, Clock, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Stop = {
  id: string;
  label: string;
  address: string;
  startTime: string;
  endTime: string;
  driveMinutesFromPrev: number | null;
};

type TodayResponse =
  | {
      hasHome: true;
      date: string;
      stops: Stop[];
      totalDriveMinutes: number;
      returnDriveMinutes: number | null;
    }
  | {
      hasHome: false;
      date: string;
      stops: Stop[];
      totalDriveMinutes: 0;
      returnDriveMinutes: null;
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

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function TodayRoute({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/today", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        setData(null);
      } else {
        setData(json as TodayResponse);
      }
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Nothing on the books today — keep the /leads header tight and don't render.
  if (!loading && !error && data && data.stops.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
            <Car className="h-3.5 w-3.5" /> Today&apos;s route
          </div>
          <div className="font-semibold">
            {data ? formatDate(data.date) : "Loading…"}
          </div>
          {data && data.stops.length > 0 && (
            <div className="text-xs text-[var(--muted)] mt-0.5">
              {data.stops.length === 1 ? "1 job" : `${data.stops.length} jobs`}
              {data.hasHome && ` · ${data.totalDriveMinutes} min driving`}
            </div>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh route"
          className="inline-flex items-center justify-center h-9 w-9 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {error && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {data && data.stops.length > 0 && (
        <ol className="space-y-0">
          {data.hasHome && (
            <TimelineItem
              icon={<Home className="h-3.5 w-3.5" />}
              title="Home"
              subtitle="Start of day"
              connector
            />
          )}
          {data.stops.map((s, i) => (
            <div key={s.id}>
              {s.driveMinutesFromPrev != null && (
                <DriveLeg minutes={s.driveMinutesFromPrev} />
              )}
              <TimelineItem
                icon={<MapPin className="h-3.5 w-3.5" />}
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
                connector={i < data.stops.length - 1 || data.hasHome}
              />
            </div>
          ))}
          {data.hasHome && data.returnDriveMinutes != null && (
            <>
              <DriveLeg minutes={data.returnDriveMinutes} />
              <TimelineItem
                icon={<Home className="h-3.5 w-3.5" />}
                title="Home"
                subtitle="End of day"
              />
            </>
          )}
        </ol>
      )}
    </div>
  );
}

function TimelineItem({
  icon,
  title,
  subtitle,
  connector,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  connector?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-7 w-7 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
          {icon}
        </div>
        {connector && <div className="w-px flex-1 bg-[var(--border)] my-1" />}
      </div>
      <div className={cn("pb-1 min-w-0", connector ? "pb-4" : "")}>
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-[var(--muted)] flex items-center flex-wrap">
          {subtitle}
        </div>
      </div>
    </li>
  );
}

function DriveLeg({ minutes }: { minutes: number }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center w-7">
        <div className="w-px h-4 bg-[var(--border)]" />
      </div>
      <div className="text-[11px] text-[var(--muted)] -mt-1 flex items-center gap-1">
        <Car className="h-3 w-3" />
        {minutes} min drive
      </div>
    </li>
  );
}
