"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Settings = {
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  default_job_minutes: number;
  travel_buffer_minutes: number;
};

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => setS(j.settings))
      .catch(() => setError("Couldn't load settings"))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleDay(d: number) {
    if (!s) return;
    const next = s.work_days.includes(d)
      ? s.work_days.filter((x) => x !== d)
      : [...s.work_days, d].sort((a, b) => a - b);
    update("work_days", next);
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home_address: s.home_address?.trim() || null,
          home_city: s.home_city?.trim() || null,
          home_state: s.home_state?.trim() || null,
          home_zip: s.home_zip?.trim() || null,
          work_start_time: s.work_start_time,
          work_end_time: s.work_end_time,
          work_days: s.work_days,
          default_job_minutes: s.default_job_minutes,
          travel_buffer_minutes: s.travel_buffer_minutes,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Save failed (${res.status})`);
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="mt-6 h-64 rounded-2xl bg-gray-100 animate-pulse" />
      </main>
    );
  }
  if (!s) {
    return (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <p className="text-sm text-red-700">{error ?? "No settings"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Settings</h1>
        <span className="w-12" aria-hidden />
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Starting location</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Used as the first stop of every workday when the scheduler ranks slots.
          </p>
        </div>

        <Field label="Street address">
          <input
            className={inputCls}
            value={s.home_address ?? ""}
            onChange={(e) => update("home_address", e.target.value)}
            placeholder="123 Main St"
            autoComplete="street-address"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="City">
            <input
              className={inputCls}
              value={s.home_city ?? ""}
              onChange={(e) => update("home_city", e.target.value)}
              placeholder="Jacksonville"
              autoComplete="address-level2"
            />
          </Field>
          <Field label="State">
            <input
              className={inputCls}
              value={s.home_state ?? ""}
              onChange={(e) => update("home_state", e.target.value)}
              placeholder="FL"
              maxLength={2}
              autoComplete="address-level1"
            />
          </Field>
          <Field label="Zip">
            <input
              className={inputCls}
              value={s.home_zip ?? ""}
              onChange={(e) => update("home_zip", e.target.value)}
              placeholder="32210"
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Working hours</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            The scheduler will only suggest slots inside this window on work days.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Day starts">
            <input
              type="time"
              className={inputCls}
              value={s.work_start_time.slice(0, 5)}
              onChange={(e) => update("work_start_time", e.target.value)}
            />
          </Field>
          <Field label="Day ends">
            <input
              type="time"
              className={inputCls}
              value={s.work_end_time.slice(0, 5)}
              onChange={(e) => update("work_end_time", e.target.value)}
            />
          </Field>
        </div>

        <div>
          <div className="text-xs font-medium text-[var(--muted)] mb-1.5">Work days</div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={cn(
                  "h-10 min-w-[3rem] px-2.5 rounded-lg border text-sm font-medium transition-colors",
                  s.work_days.includes(d.value)
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Job timing</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Defaults for scheduling math. Per-lead overrides come later.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Default job length (min)">
            <input
              type="number"
              min={5}
              max={600}
              step={5}
              className={inputCls}
              value={s.default_job_minutes}
              onChange={(e) =>
                update(
                  "default_job_minutes",
                  Math.max(5, Math.min(600, Number(e.target.value) || 0))
                )
              }
              inputMode="numeric"
            />
          </Field>
          <Field label="Travel buffer (min)">
            <input
              type="number"
              min={0}
              max={120}
              step={5}
              className={inputCls}
              value={s.travel_buffer_minutes}
              onChange={(e) =>
                update(
                  "travel_buffer_minutes",
                  Math.max(0, Math.min(120, Number(e.target.value) || 0))
                )
              }
              inputMode="numeric"
            />
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        {error ? (
          <p className="text-sm text-red-700 flex-1">{error}</p>
        ) : savedAt && Date.now() - savedAt < 4000 ? (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <Check className="h-4 w-4" /> Saved
          </p>
        ) : (
          <span className="flex-1" />
        )}
        <button
          onClick={save}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-sm font-semibold",
            "bg-[var(--accent)] text-white hover:opacity-95 active:opacity-90 disabled:opacity-60"
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </main>
  );
}

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--muted)] mb-1">{label}</div>
      {children}
    </label>
  );
}
