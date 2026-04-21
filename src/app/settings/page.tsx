"use client";

/**
 * Settings page. Edits update local state only; nothing is persisted
 * until the user explicitly taps the Save button at the bottom of the
 * page. The autosave path was too aggressive for the setup flow
 * (every keystroke fired a PUT, and tab-switch flushes were racing
 * against the UI), so the page now behaves like a traditional form.
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
 * Errors from the PUT surface as toasts. On success the provider is
 * updated in-place so the rest of the app picks up the new values
 * without a reload.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
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

/**
 * Shallow diff between two settings snapshots. Only fields that the
 * UI renders as editable are compared; the server is authoritative
 * for the rest. Arrays (work_days, salespeople) are compared via
 * JSON.stringify — both are short and primitives-only.
 */
const EDITABLE_KEYS = [
  "company_name",
  "company_phone",
  "company_email",
  "salespeople",
  "sms_intro_template",
  "sms_confirm_template",
  "email_subject_template",
  "email_body_template",
  "home_address",
  "home_city",
  "home_state",
  "home_zip",
  "work_start_time",
  "work_end_time",
  "work_days",
  "default_job_minutes",
  "travel_buffer_minutes",
] as const satisfies ReadonlyArray<keyof ClientAppSettings>;

function diffSettings(next: ClientAppSettings, prev: ClientAppSettings): Patch {
  const patch: Patch = {};
  for (const key of EDITABLE_KEYS) {
    const a = next[key];
    const b = prev[key];
    const same =
      Array.isArray(a) && Array.isArray(b)
        ? JSON.stringify(a) === JSON.stringify(b)
        : a === b;
    if (!same) {
      // Assignment goes through `unknown` so TS doesn't infer each
      // field's individual union type for the merged patch.
      (patch as Record<string, unknown>)[key] = a;
    }
  }
  return patch;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings: ctxSettings, apply } = useAppSettings();

  const [loading, setLoading] = useState(true);
  const [s, setS] = useState<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const [saving, setSaving] = useState(false);
  // The last-saved snapshot. Used to compute dirty state and the diff
  // we send on Save. Updated on mount from ctxSettings and after each
  // successful PUT.
  const savedRef = useRef<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const [savedTick, setSavedTick] = useState(0);

  // Initial load: seed local state + savedRef from the server-side
  // settings the provider has already fetched. We treat ctxSettings as
  // authoritative on mount only — once the page is open, edits live in
  // `s` until the user taps Save.
  useEffect(() => {
    setS(ctxSettings);
    savedRef.current = ctxSettings;
    setSavedTick((t) => t + 1);
    setLoading(false);
  }, [ctxSettings]);

  // savedTick forces a recompute after each successful save so the
  // "All changes saved" state flips immediately. The lint rule doesn't
  // see that savedRef.current changes in lockstep with savedTick, so
  // we disable the warning here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const patch = useMemo(() => diffSettings(s, savedRef.current), [s, savedTick]);
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
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
      // Server-normalized settings become the new baseline. Merge onto
      // the current local state so any field the server doesn't echo
      // back stays as the user typed it.
      const serverPatch = (json?.settings ?? {}) as Partial<ClientAppSettings>;
      const nextSaved: ClientAppSettings = { ...s, ...serverPatch };
      savedRef.current = nextSaved;
      setS(nextSaved);
      setSavedTick((t) => t + 1);
      if (json?.settings) apply(serverPatch);
      toast({ kind: "success", message: "Saved" });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    setS(savedRef.current);
    setSavedTick((t) => t + 1);
  }

  function update<K extends keyof ClientAppSettings>(
    key: K,
    value: ClientAppSettings[K]
  ) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(d: number) {
    const next = s.work_days.includes(d)
      ? s.work_days.filter((x) => x !== d)
      : [...s.work_days, d].sort((a, b) => a - b);
    update("work_days", next);
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
        <span
          className={cn(
            "text-xs font-medium",
            dirty
              ? "text-amber-600"
              : "text-[var(--muted)]"
          )}
          aria-live="polite"
        >
          {dirty ? "Unsaved changes" : "All changes saved"}
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
            placeholder="Arbor Tech 904"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Company phone">
            <input
              className={inputCls}
              value={s.company_phone ?? ""}
              onChange={(e) => update("company_phone", e.target.value)}
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
          onChange={(next) => update("salespeople", next)}
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
        />
        <TemplateField
          label="Confirmation SMS (after booking)"
          rows={4}
          value={s.sms_confirm_template ?? ""}
          onChange={(v) => update("sms_confirm_template", v)}
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
        />
        <TemplateField
          label="Body"
          rows={8}
          value={s.email_body_template ?? ""}
          onChange={(v) => update("email_body_template", v)}
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
              onCommit={(n) => update("default_job_minutes", n)}
            />
          </Field>
          <Field label="Travel buffer (min)">
            <NumberField
              value={s.travel_buffer_minutes}
              min={0}
              max={120}
              onCommit={(n) => update("travel_buffer_minutes", n)}
            />
          </Field>
        </div>
      </Panel>

      {/*
        Spacer under the sticky save bar so the last panel isn't
        hidden behind the bar on mobile.
      */}
      <div className="h-24" aria-hidden />

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onRevert={revert}
      />
    </main>
  );
}

function SaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-white/95 backdrop-blur",
        "px-4 py-3 sm:px-6"
      )}
    >
      <div className="mx-auto max-w-2xl flex items-center gap-2">
        <button
          type="button"
          onClick={onRevert}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-11 text-sm font-medium disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
          Revert
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] text-white h-11 text-sm font-semibold disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : dirty ? (
            <>
              <Check className="h-4 w-4" /> Save changes
            </>
          ) : (
            <>All changes saved</>
          )}
        </button>
      </div>
    </div>
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
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (next: string) => void;
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
    onBlur: rememberCaret,
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
 * then clamps into [min, max] on blur.
 *
 * UX contract:
 *   - The *visible* draft is free-form (can be empty, can be out of
 *     range) so the user can clear the field and type a new value
 *     without the clamp snapping them back to the minimum mid-edit.
 *   - The *parent* state is kept fresh on every keystroke (clamped to
 *     [min, max]) so the surrounding autosave machinery
 *     (visibilitychange / pagehide / unmount → flush) never loses the
 *     edit if the user backgrounds the tab before blurring.
 *   - On blur we re-render the draft as the clamped value for
 *     feedback.
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
  const ref = useRef<HTMLInputElement | null>(null);

  // Keep local draft in sync if the saved value changes out-of-band
  // (e.g. PUT response normalizes the value) and we are not actively
  // editing — `document.activeElement` dodges clobbering a mid-edit.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) return;
    setDraft(String(value));
  }, [value]);

  function commit(raw: string) {
    if (raw.trim() === "") return; // mid-edit; don't clobber pending.current
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <input
      ref={ref}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={5}
      className={inputCls}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Keep the parent's pending patch fresh so a tab switch or
        // pagehide before blur still persists the edit.
        commit(raw);
      }}
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

