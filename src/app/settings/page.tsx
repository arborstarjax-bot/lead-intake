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
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useAppSettings } from "@/components/SettingsProvider";
import { type ClientAppSettings } from "@/lib/client-settings";
import {
  DAYS,
  DEFAULT_CLIENT_SETTINGS,
  diffSettings,
  inputCls,
} from "./settings-helpers";
import { Field, Panel } from "./components/Panel";
import { SaveBar } from "./components/SaveBar";
import { DefaultSalespersonPicker } from "./components/DefaultSalespersonPicker";
import { SalespeopleEditor } from "./components/SalespeopleEditor";
import { TemplateField } from "./components/TemplateField";
import { NumberField } from "./components/NumberField";
import { IntegrationsPanel } from "./components/IntegrationsPanel";

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings: ctxSettings, role, apply } = useAppSettings();
  const canEdit = role === "admin";

  const [loading, setLoading] = useState(true);
  const [s, setS] = useState<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const [saving, setSaving] = useState(false);
  // The last-saved snapshot. Used to compute dirty state and the diff
  // we send on Save. Updated on mount from ctxSettings and after each
  // successful PUT.
  const savedRef = useRef<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const [savedTick, setSavedTick] = useState(0);
  // Once the user touches a field or saves, stop letting ctxSettings
  // (which we update via apply() after each save, and which starts at
  // DEFAULT_CLIENT_SETTINGS before the provider fetches) overwrite
  // local state. Otherwise edits typed during an in-flight save get
  // silently reset when apply() lands.
  const touchedRef = useRef(false);

  // Seed local state + savedRef from the provider. Only fires before
  // the user has touched anything, so subsequent provider updates (e.g.
  // after we call apply()) don't clobber in-flight edits.
  useEffect(() => {
    if (touchedRef.current) return;
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
    touchedRef.current = true;
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
      // The server echoes back the full normalized row (`.select("*").single()`).
      // Use it as the new baseline for dirty computation, but do NOT
      // overwrite local `s` — the user may have typed more fields while
      // the fetch was in flight, and those should survive. Any such
      // edits will naturally show as dirty (they differ from the new
      // baseline) so the user can tap Save again.
      const serverSettings = (json?.settings ?? null) as
        | ClientAppSettings
        | null;
      if (serverSettings) {
        savedRef.current = serverSettings;
        apply(serverSettings);
      }
      setSavedTick((t) => t + 1);
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
    touchedRef.current = true;
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
      <PageHeader
        title="Settings"
        rightSlot={
          canEdit ? (
            <span
              className={cn(
                "text-xs font-medium whitespace-nowrap",
                dirty ? "text-amber-600" : "text-[var(--muted)]"
              )}
              aria-live="polite"
            >
              {dirty ? "Unsaved" : "Saved"}
            </span>
          ) : (
            <span className="text-xs font-medium text-[var(--muted)] whitespace-nowrap">
              Read only
            </span>
          )
        }
      />

      {!canEdit && role === "user" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2">
          Only workspace admins can change settings. Ask an admin to make
          edits on your behalf.
        </div>
      ) : null}

      {/* Integrations (calendar sync + notifications) */}
      <IntegrationsPanel />

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
          onChange={(next) => {
            update("salespeople", next);
            // If the chosen default is no longer in the roster, clear
            // it so "Default salesperson" doesn't render a ghost chip.
            if (
              s.default_salesperson &&
              !next.some(
                (n) =>
                  n.toLowerCase() === s.default_salesperson!.toLowerCase()
              )
            ) {
              update("default_salesperson", null);
            }
          }}
        />
      </Panel>

      {/* Default salesperson */}
      <Panel
        title="Default salesperson"
        description="Used whenever a lead doesn't have a salesperson assigned. Shows up in SMS / email {salesPerson} as a fallback so templates still read correctly for un-assigned leads."
      >
        <DefaultSalespersonPicker
          roster={s.salespeople}
          value={s.default_salesperson}
          onChange={(next) => update("default_salesperson", next)}
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
        <TemplateField
          label="En route SMS (I'm on my way)"
          rows={4}
          value={s.sms_enroute_template ?? ""}
          onChange={(v) => update("sms_enroute_template", v)}
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
      {canEdit ? <div className="h-24" aria-hidden /> : null}

      {canEdit ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={save}
          onRevert={revert}
        />
      ) : null}
    </main>
  );
}
