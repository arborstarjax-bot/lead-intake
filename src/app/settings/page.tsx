"use client";

/**
 * Settings page. Every field autosaves on blur (500 ms after the last
 * keystroke on textareas, immediately on leaving an input). No "Save
 * changes" button — matches the autosave pattern the rest of the app
 * already uses inside LeadCard.
 *
 * Sections:
 *   1. Company         — name, phone, email used in SMS / email copy
 *   2. Salespeople     — roster surfaced as chips on each LeadCard
 *   3. SMS templates   — first-touch + booking confirmation
 *   4. Email template  — subject + body, triggered from the envelope icon
 *   5. Starting location — where the workday begins for route math
 *   6. Working hours   — day window + work days bitmap
 *   7. Job timing      — default job length + travel buffer
 *
 * Editing any field updates local state optimistically. The patch is
 * deferred by ~500 ms and flushed on blur / tab hide / page leave so
 * edits are never silently lost (same contract as InlineField in
 * LeadTable). Errors surface as toasts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useAppSettings } from "@/components/SettingsProvider";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/templates";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientAppSettings,
} from "@/lib/client-settings";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

type Patch = Partial<ClientAppSettings>;

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings: ctxSettings, apply } = useAppSettings();

  const [loading, setLoading] = useState(true);
  const [s, setS] = useState<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);

  // Track the most recent unsaved patch so flush() can persist on
  // blur / visibilitychange / pagehide without relying on stale closures.
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  // `flush` is self-referential (it retries itself after a save completes
  // if more edits came in mid-flight), so declare the ref up front.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // If a save is already in flight, leave pending.current alone. The
    // in-flight save's `finally` will re-invoke flush() so the newer
    // fields are posted in a follow-up request instead of dropped.
    if (savingRef.current) return;
    const patch = pending.current;
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    pending.current = {};
    savingRef.current = true;
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Save failed" });
        return;
      }
      if (json?.settings) {
        apply(json.settings as Partial<ClientAppSettings>);
      }
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      savingRef.current = false;
      // Anything typed mid-save now gets its own round-trip.
      if (Object.keys(pending.current).length > 0) {
        // Break out of this call's stack so React can batch state
        // updates and the caller can finish its own `finally`.
        setTimeout(() => flushRef.current(), 0);
      }
    }
  }, [apply, toast]);

  // Keep the ref pointing at the latest flush so the setTimeout retry
  // above always sees the current closure.
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Initial load: seed local state from the server-side settings the
  // provider has already fetched (or is fetching). This file owns the
  // only editor, so we treat ctxSettings as authoritative on mount only.
  useEffect(() => {
    setS(ctxSettings);
    setLoading(false);
  }, [ctxSettings]);

  // Flush pending edits on tab hide / page leave so switching apps
  // mid-edit doesn't silently drop the patch.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  // Unmount flush — navigating back to Home shouldn't drop the last field.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  function update<K extends keyof ClientAppSettings>(
    key: K,
    value: ClientAppSettings[K],
    { immediate = false }: { immediate?: boolean } = {}
  ) {
    setS((prev) => ({ ...prev, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    if (immediate) {
      flush();
    } else {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    }
  }

  function toggleDay(d: number) {
    const next = s.work_days.includes(d)
      ? s.work_days.filter((x) => x !== d)
      : [...s.work_days, d].sort((a, b) => a - b);
    update("work_days", next, { immediate: true });
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="mt-6 h-64 rounded-2xl bg-gray-100 animate-pulse" />
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
        <span className="w-12 text-right text-xs text-[var(--muted)]" aria-hidden>
          Autosaves
        </span>
      </header>

      {/* Company info */}
      <Panel
        title="Company info"
        description="Used to sign SMS / email templates and fill the {companyName} placeholder."
      >
        <Field label="Company name">
          <input
            className={inputCls}
            value={s.company_name ?? ""}
            onChange={(e) => update("company_name", e.target.value)}
            onBlur={flush}
            placeholder="Arbor Tech 904"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Company phone">
            <input
              className={inputCls}
              value={s.company_phone ?? ""}
              onChange={(e) => update("company_phone", e.target.value)}
              onBlur={flush}
              placeholder="(904) 555-0100"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label="Company email">
            <input
              className={inputCls}
              value={s.company_email ?? ""}
              onChange={(e) => update("company_email", e.target.value)}
              onBlur={flush}
              placeholder="hello@arbortech904.com"
              inputMode="email"
              autoComplete="email"
            />
          </Field>
        </div>
      </Panel>

      {/* Salespeople */}
      <Panel
        title="Salespeople"
        description="Becomes a chip list on every lead card. The name of the person in the field goes into the SMS / email {salesPerson} placeholder."
      >
        <SalespeopleEditor
          roster={s.salespeople}
          onChange={(next) => update("salespeople", next, { immediate: true })}
        />
      </Panel>

      {/* SMS templates */}
      <Panel
        title="Text message templates"
        description="Tap SMS on a lead to open Messages pre-filled with the intro; confirm SMS is offered after Find best time books an appointment. Tap a placeholder chip below to drop it into the template at the cursor."
      >
        <TemplateField
          label="First-touch SMS (intro)"
          rows={5}
          value={s.sms_intro_template ?? ""}
          onChange={(v) => update("sms_intro_template", v)}
          onCommit={flush}
        />
        <TemplateField
          label="Confirmation SMS (after booking)"
          rows={4}
          value={s.sms_confirm_template ?? ""}
          onChange={(v) => update("sms_confirm_template", v)}
          onCommit={flush}
        />
      </Panel>

      {/* Email template */}
      <Panel
        title="Email template"
        description="Tap Email on a lead to compose with these as the subject and body. Uses your default mail app via mailto:. Tap a placeholder chip to insert it at the cursor."
      >
        <TemplateField
          label="Subject"
          rows={1}
          value={s.email_subject_template ?? ""}
          onChange={(v) => update("email_subject_template", v)}
          onCommit={flush}
        />
        <TemplateField
          label="Body"
          rows={8}
          value={s.email_body_template ?? ""}
          onChange={(v) => update("email_body_template", v)}
          onCommit={flush}
        />
      </Panel>

      {/* Starting location */}
      <Panel
        title="Starting location"
        description="Used as the first stop of every workday when the scheduler ranks slots."
      >
        <Field label="Street address">
          <input
            className={inputCls}
            value={s.home_address ?? ""}
            onChange={(e) => update("home_address", e.target.value)}
            onBlur={flush}
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
              onBlur={flush}
              placeholder="Jacksonville"
              autoComplete="address-level2"
            />
          </Field>
          <Field label="State">
            <input
              className={inputCls}
              value={s.home_state ?? ""}
              onChange={(e) => update("home_state", e.target.value)}
              onBlur={flush}
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
              onBlur={flush}
              placeholder="32210"
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </Field>
        </div>
      </Panel>

      {/* Working hours */}
      <Panel
        title="Working hours"
        description="The scheduler will only suggest slots inside this window on work days."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day starts">
            <input
              type="time"
              className={inputCls}
              value={s.work_start_time.slice(0, 5)}
              onChange={(e) =>
                update("work_start_time", e.target.value, { immediate: true })
              }
            />
          </Field>
          <Field label="Day ends">
            <input
              type="time"
              className={inputCls}
              value={s.work_end_time.slice(0, 5)}
              onChange={(e) =>
                update("work_end_time", e.target.value, { immediate: true })
              }
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
      </Panel>

      {/* Job timing */}
      <Panel
        title="Job timing"
        description="Defaults for scheduling math. Per-lead overrides come later."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default job length (min)">
            <NumberField
              value={s.default_job_minutes}
              min={5}
              max={600}
              onCommit={(n) => {
                update("default_job_minutes", n);
                flush();
              }}
            />
          </Field>
          <Field label="Travel buffer (min)">
            <NumberField
              value={s.travel_buffer_minutes}
              min={0}
              max={120}
              onCommit={(n) => {
                update("travel_buffer_minutes", n);
                flush();
              }}
            />
          </Field>
        </div>
      </Panel>
    </main>
  );
}

function SalespeopleEditor({
  roster,
  onChange,
}: {
  roster: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const list = useMemo(() => roster.filter((n) => n.trim().length > 0), [roster]);

  function add() {
    const name = draft.trim();
    if (!name) return;
    if (list.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...list, name]);
    setDraft("");
  }

  function remove(name: string) {
    onChange(list.filter((n) => n !== name));
  }

  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((name) => (
            <li
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 h-9 text-sm"
            >
              <span>{name}</span>
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                className="text-[var(--muted)] hover:text-[var(--fg)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-stretch gap-2">
        <input
          className={inputCls}
          value={draft}
          placeholder="Add a salesperson"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 h-11 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-95 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Template editor: a textarea (or single-line input when rows=1) plus a
 * row of tappable placeholder chips that drop `{firstName}` etc. at the
 * current cursor position. Avoids forcing the user to type curly braces
 * on a phone keyboard.
 */
function TemplateField({
  label,
  value,
  rows,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (next: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // Remember the last cursor position even after the textarea blurs so
  // that tapping a chip still inserts at the right spot on mobile.
  const caretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  function rememberCaret() {
    const el = ref.current;
    if (!el) return;
    caretRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }

  function insert(token: string) {
    const el = ref.current;
    const { start, end } = caretRef.current;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Restore focus + caret after React re-renders so the user can keep
    // typing. We also remember the new caret for the next chip tap.
    const caret = start + token.length;
    caretRef.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // Some input types (e.g. type=email) don't support setSelectionRange.
      }
    });
  }

  const common = {
    value,
    placeholder: "Leave blank to use the built-in default",
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value);
    },
    onBlur: () => {
      rememberCaret();
      onCommit();
    },
    onKeyUp: rememberCaret,
    onClick: rememberCaret,
    onSelect: rememberCaret,
  };

  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--muted)] mb-1">{label}</div>
      {rows > 1 ? (
        <textarea
          {...common}
          ref={(el) => {
            ref.current = el;
          }}
          className={textareaCls}
          rows={rows}
        />
      ) : (
        <input
          {...common}
          ref={(el) => {
            ref.current = el;
          }}
          className={inputCls}
        />
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {TEMPLATE_PLACEHOLDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => insert(`{${p}}`)}
            // Prevent the textarea from losing focus (and thus losing its
            // selection) before we insert on mousedown on desktop.
            onMouseDown={(e) => e.preventDefault()}
            className="inline-flex items-center h-7 px-2.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[11px] font-mono text-[var(--fg)] hover:bg-slate-200 active:scale-[0.98]"
          >
            {`{${p}}`}
          </button>
        ))}
      </div>
    </label>
  );
}

/**
 * Number input that lets the user fully clear the value while typing,
 * then clamps into [min, max] on blur. The old `Math.max(min, …)` inside
 * onChange prevented deleting the last digit because the clamp would
 * instantly rewrite "" back to the minimum.
 */
function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Keep local draft in sync if the saved value changes out-of-band.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={5}
      className={inputCls}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        const clamped = Number.isFinite(n)
          ? Math.max(min, Math.min(max, Math.round(n)))
          : min;
        setDraft(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
    />
  );
}

function Panel({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{description}</p>
      </div>
      {children}
      {footer ? <div>{footer}</div> : null}
    </section>
  );
}

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

const textareaCls =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--muted)] mb-1">{label}</div>
      {children}
    </label>
  );
}

