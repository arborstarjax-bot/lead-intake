"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { Panel, Field } from "./Panel";

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";
const textareaCls =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y";

type VoiceConfig = {
  enabled: boolean;
  agent_name: string;
  agent_name_male: string | null;
  agent_name_female: string | null;
  company_name: string | null;
  greeting_template: string | null;
  system_prompt: string | null;
  vapi_assistant_id: string | null;
  vapi_phone_id: string | null;
  voice_provider: string;
  voice_id: string | null;
  call_window_start: string;
  call_window_end: string;
  call_days: number[];
  timezone: string;
  max_attempts: number;
  retry_delay_mins: number;
  concurrent_calls: number;
  auto_call_new_leads: boolean;
  auto_follow_up_no_answer: boolean;
  auto_follow_up_estimates: boolean;
  auto_reengage_dormant: boolean;
  dormant_days_threshold: number;
  transfer_phone_number: string | null;
  transfer_enabled: boolean;
};

const CALL_DAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 7, label: "S" },
];

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  agent_name: "AI Assistant",
  agent_name_male: null,
  agent_name_female: null,
  company_name: null,
  greeting_template: null,
  system_prompt: null,
  vapi_assistant_id: null,
  vapi_phone_id: null,
  voice_provider: "elevenlabs",
  voice_id: null,
  call_window_start: "09:00",
  call_window_end: "17:00",
  call_days: [1, 2, 3, 4, 5],
  timezone: "America/New_York",
  max_attempts: 3,
  retry_delay_mins: 60,
  concurrent_calls: 2,
  auto_call_new_leads: true,
  auto_follow_up_no_answer: true,
  auto_follow_up_estimates: false,
  auto_reengage_dormant: false,
  dormant_days_threshold: 14,
  transfer_phone_number: null,
  transfer_enabled: true,
};

const DEFAULT_GREETING =
  "Hi, this is {{agent_name}} from {{company_name}}. I'm calling because you reached out about tree service — is now a good time to chat for a minute?";

/** Normalize any time string (AM/PM, narrow-space, etc.) to HH:MM 24h. */
function normalizeTime(val: string): string {
  const cleaned = val.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  const ampm = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2];
    const period = ampm[3].toUpperCase().replace(/\./g, "");
    if (period === "PM" && h < 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m}`;
  }
  const simple = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (simple) return `${simple[1].padStart(2, "0")}:${simple[2]}`;
  return cleaned;
}

export function VoiceAgentPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<VoiceConfig>(DEFAULT_CONFIG);
  const savedRef = useRef<VoiceConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/voice/config")
      .then((r) => r.json())
      .then((json) => {
        if (json.config) {
          const c = { ...DEFAULT_CONFIG, ...json.config } as VoiceConfig;
          setConfig(c);
          savedRef.current = c;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const checkDirty = useCallback(
    (c: VoiceConfig) =>
      setDirty(JSON.stringify(c) !== JSON.stringify(savedRef.current)),
    []
  );

  function update<K extends keyof VoiceConfig>(key: K, value: VoiceConfig[K]) {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      checkDirty(next);
      return next;
    });
  }

  function toggleDay(d: number) {
    const next = config.call_days.includes(d)
      ? config.call_days.filter((x) => x !== d)
      : [...config.call_days, d].sort((a, b) => a - b);
    update("call_days", next);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      // Normalize time fields before sending — iOS <input type="time">
      // may return 12h AM/PM format depending on locale
      const payload = {
        ...config,
        call_window_start: normalizeTime(config.call_window_start),
        call_window_end: normalizeTime(config.call_window_end),
      };
      const res = await fetch("/api/voice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Save failed" });
        return;
      }
      if (json.config) {
        const c = { ...DEFAULT_CONFIG, ...json.config } as VoiceConfig;
        savedRef.current = c;
        setConfig(c);
        setDirty(false);
      }
      toast({ kind: "success", message: "Voice agent settings saved" });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <div className="h-5 w-36 rounded bg-gray-100 animate-pulse" />
        <div className="mt-4 h-32 rounded-xl bg-gray-100 animate-pulse" />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <Panel
        title="AI Voice Agent"
        description="Automatically call, qualify, and schedule new leads using an AI voice assistant."
        footer={
          dirty && canEdit ? (
            <button
              onClick={save}
              disabled={saving}
              className="w-full h-10 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save voice agent settings"}
            </button>
          ) : null
        }
      >
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Enable AI calling</span>
          <button
            disabled={!canEdit}
            onClick={() => update("enabled", !config.enabled)}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              config.enabled ? "bg-green-500" : "bg-gray-300"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                config.enabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>

        {config.enabled && (
          <div className="space-y-5 pt-2">
            {/* Persona */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                Persona
              </h3>
              <Field label="Male agent name (used when calling female leads)">
                <input
                  className={inputCls}
                  value={config.agent_name_male ?? config.agent_name}
                  onChange={(e) => {
                    update("agent_name_male", e.target.value || null);
                    update("agent_name", e.target.value || "AI Assistant");
                  }}
                  placeholder="David Martin"
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Female agent name (used when calling male leads)">
                <input
                  className={inputCls}
                  value={config.agent_name_female ?? ""}
                  onChange={(e) => update("agent_name_female", e.target.value || null)}
                  placeholder="Sarah"
                  disabled={!canEdit}
                />
              </Field>
              <p className="text-xs text-[var(--muted)]">
                The AI uses the opposite gender voice/name to the lead. Male leads hear the female agent, female leads hear the male agent.
              </p>
              {/* Company name comes from workspace Company Info settings */}
              <Field label="Greeting script">
                <textarea
                  className={cn(textareaCls, "min-h-[80px]")}
                  value={config.greeting_template ?? DEFAULT_GREETING}
                  onChange={(e) =>
                    update("greeting_template", e.target.value || null)
                  }
                  placeholder={DEFAULT_GREETING}
                  disabled={!canEdit}
                  rows={3}
                />
                <p className="text-xs text-[var(--muted)] mt-1">
                  Variables: {"{{agent_name}}"}, {"{{company_name}}"},{" "}
                  {"{{first_name}}"}, {"{{address}}"}
                </p>
              </Field>
            </div>

            {/* Auto-call triggers */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                Auto-call triggers
              </h3>
              <Toggle
                label="Call new leads automatically"
                checked={config.auto_call_new_leads}
                onChange={(v) => update("auto_call_new_leads", v)}
                disabled={!canEdit}
              />
              <Toggle
                label="Retry leads who don't answer"
                checked={config.auto_follow_up_no_answer}
                onChange={(v) => update("auto_follow_up_no_answer", v)}
                disabled={!canEdit}
              />
              <Toggle
                label="Follow up on pending estimates"
                checked={config.auto_follow_up_estimates}
                onChange={(v) => update("auto_follow_up_estimates", v)}
                disabled={!canEdit}
              />
              <Toggle
                label="Re-engage dormant leads"
                checked={config.auto_reengage_dormant}
                onChange={(v) => update("auto_reengage_dormant", v)}
                disabled={!canEdit}
              />
              {config.auto_reengage_dormant && (
                <Field label="Days until considered dormant">
                  <input
                    type="number"
                    className={inputCls}
                    value={config.dormant_days_threshold}
                    onChange={(e) =>
                      update(
                        "dormant_days_threshold",
                        parseInt(e.target.value) || 14
                      )
                    }
                    min={1}
                    max={365}
                    disabled={!canEdit}
                  />
                </Field>
              )}
            </div>

            {/* Calling hours */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                Calling hours
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <input
                    type="time"
                    className={inputCls}
                    value={config.call_window_start}
                    onChange={(e) =>
                      update("call_window_start", e.target.value)
                    }
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="End">
                  <input
                    type="time"
                    className={inputCls}
                    value={config.call_window_end}
                    onChange={(e) => update("call_window_end", e.target.value)}
                    disabled={!canEdit}
                  />
                </Field>
              </div>
              <Field label="Call days">
                <div className="flex gap-1.5">
                  {CALL_DAYS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => toggleDay(d.value)}
                      disabled={!canEdit}
                      className={cn(
                        "w-9 h-9 rounded-lg text-xs font-medium transition-colors",
                        config.call_days.includes(d.value)
                          ? "bg-[var(--accent)] text-white"
                          : "bg-gray-100 text-gray-500"
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Timezone">
                <input
                  className={inputCls}
                  value={config.timezone}
                  onChange={(e) => update("timezone", e.target.value)}
                  placeholder="America/New_York"
                  disabled={!canEdit}
                />
              </Field>
            </div>

            {/* Call limits */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                Call limits
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Max attempts">
                  <input
                    type="number"
                    className={inputCls}
                    value={config.max_attempts}
                    onChange={(e) =>
                      update("max_attempts", parseInt(e.target.value) || 3)
                    }
                    min={1}
                    max={10}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Retry (min)">
                  <input
                    type="number"
                    className={inputCls}
                    value={config.retry_delay_mins}
                    onChange={(e) =>
                      update(
                        "retry_delay_mins",
                        parseInt(e.target.value) || 60
                      )
                    }
                    min={5}
                    max={1440}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Concurrent">
                  <input
                    type="number"
                    className={inputCls}
                    value={config.concurrent_calls}
                    onChange={(e) =>
                      update(
                        "concurrent_calls",
                        parseInt(e.target.value) || 2
                      )
                    }
                    min={1}
                    max={10}
                    disabled={!canEdit}
                  />
                </Field>
              </div>
            </div>

            {/* Human transfer */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                Human transfer
              </h3>
              <Toggle
                label="Allow transfer to human"
                checked={config.transfer_enabled}
                onChange={(v) => update("transfer_enabled", v)}
                disabled={!canEdit}
              />
              {config.transfer_enabled && (
                <Field label="Transfer to phone number">
                  <input
                    className={inputCls}
                    value={config.transfer_phone_number ?? ""}
                    onChange={(e) =>
                      update(
                        "transfer_phone_number",
                        e.target.value || null
                      )
                    }
                    placeholder="(904) 555-1234"
                    inputMode="tel"
                    disabled={!canEdit}
                  />
                </Field>
              )}
            </div>

            {/* Advanced — Vapi config */}
            <details className="group">
              <summary className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide cursor-pointer select-none">
                Advanced (Vapi)
              </summary>
              <div className="space-y-3 pt-3">
                <Field label="Vapi Assistant ID">
                  <input
                    className={inputCls}
                    value={config.vapi_assistant_id ?? ""}
                    onChange={(e) =>
                      update("vapi_assistant_id", e.target.value || null)
                    }
                    placeholder="asst_..."
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Vapi Phone Number ID">
                  <input
                    className={inputCls}
                    value={config.vapi_phone_id ?? ""}
                    onChange={(e) =>
                      update("vapi_phone_id", e.target.value || null)
                    }
                    placeholder="phn_..."
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="ElevenLabs Voice ID">
                  <input
                    className={inputCls}
                    value={config.voice_id ?? ""}
                    onChange={(e) =>
                      update("voice_id", e.target.value || null)
                    }
                    placeholder="Leave blank for default"
                    disabled={!canEdit}
                  />
                </Field>
              </div>
            </details>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
          checked ? "bg-green-500" : "bg-gray-300",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5"
          )}
        />
      </button>
    </label>
  );
}
