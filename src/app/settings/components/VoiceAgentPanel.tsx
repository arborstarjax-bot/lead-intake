"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { Panel, Field } from "./Panel";
import { Zap } from "lucide-react";

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

/* ------------------------------------------------------------------ */
/*  Types — only fields that actually exist in the DB                  */
/* ------------------------------------------------------------------ */

type VoiceConfig = {
  enabled: boolean;
  agent_name: string;
  company_name: string | null;
  greeting_template: string | null;
  system_prompt: string | null;
  vapi_assistant_id: string | null;
  vapi_phone_id: string | null;
  voice_provider: string;
  voice_id: string | null;
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

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  agent_name: "Dave",
  company_name: null,
  greeting_template: null,
  system_prompt: null,
  vapi_assistant_id: null,
  vapi_phone_id: null,
  voice_provider: "elevenlabs",
  voice_id: null,
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


/* ------------------------------------------------------------------ */
/*  Imperative handle so parent can query dirty + trigger save         */
/* ------------------------------------------------------------------ */

export type VoiceAgentHandle = {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
};

export const VoiceAgentPanel = forwardRef<
  VoiceAgentHandle,
  { canEdit: boolean; onDirtyChange?: () => void }
>(function VoiceAgentPanel({ canEdit, onDirtyChange }, ref) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
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
    (c: VoiceConfig) => {
      const isDirty = JSON.stringify(c) !== JSON.stringify(savedRef.current);
      setDirty(isDirty);
      onDirtyChange?.();
    },
    [onDirtyChange]
  );

  function update<K extends keyof VoiceConfig>(key: K, value: VoiceConfig[K]) {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      checkDirty(next);
      return next;
    });
  }

  /** Save voice config. Returns true on success. */
  async function save(): Promise<boolean> {
    if (!dirty) return true;
    try {
      const payload: Record<string, unknown> = {
        enabled: config.enabled,
        agent_name: config.agent_name,
        company_name: config.company_name,
        greeting_template: config.greeting_template,
        system_prompt: config.system_prompt,
        vapi_assistant_id: config.vapi_assistant_id,
        vapi_phone_id: config.vapi_phone_id,
        voice_provider: config.voice_provider,
        voice_id: config.voice_id,
        max_attempts: config.max_attempts,
        retry_delay_mins: config.retry_delay_mins,
        concurrent_calls: config.concurrent_calls,
        auto_call_new_leads: config.auto_call_new_leads,
        auto_follow_up_no_answer: config.auto_follow_up_no_answer,
        auto_follow_up_estimates: config.auto_follow_up_estimates,
        auto_reengage_dormant: config.auto_reengage_dormant,
        dormant_days_threshold: config.dormant_days_threshold,
        transfer_phone_number: config.transfer_phone_number,
        transfer_enabled: config.transfer_enabled,
      };
      const res = await fetch("/api/voice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Voice config save failed" });
        return false;
      }
      if (json.config) {
        const c = { ...DEFAULT_CONFIG, ...json.config } as VoiceConfig;
        savedRef.current = c;
        setConfig(c);
        setDirty(false);
      }
      return true;
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
      return false;
    }
  }

  // Expose dirty/save to parent so the unified SaveBar can include us
  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save,
  }));

  async function provision() {
    if (provisioning) return;
    setProvisioning(true);
    try {
      const res = await fetch("/api/voice/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Provisioning failed" });
        return;
      }
      toast({ kind: "success", message: "AI assistant activated!" });
      const configRes = await fetch("/api/voice/config");
      const configJson = await configRes.json();
      if (configJson.config) {
        const c = { ...DEFAULT_CONFIG, ...configJson.config } as VoiceConfig;
        setConfig(c);
        savedRef.current = c;
        setDirty(false);
      }
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setProvisioning(false);
    }
  }

  const needsProvisioning = config.enabled && !config.vapi_assistant_id;

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
      <Panel
        title="AI Voice Agent"
        description="Automatically call, qualify, and schedule new leads using an AI voice assistant."
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

        {/* Setup — shown when enabled but not yet provisioned */}
        {needsProvisioning && (
          <div className="pt-3">
            <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-green-600" />
                <h3 className="text-sm font-semibold text-green-900">
                  Activate AI assistant
                </h3>
              </div>
              <p className="text-xs text-green-800">
                Your AI caller will use your company info and working hours
                to book appointments automatically. Make sure your company
                name is set in Company Info above.
              </p>
              <button
                onClick={provision}
                disabled={provisioning || !canEdit}
                className="w-full h-11 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {provisioning ? (
                  "Setting up..."
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Activate AI Assistant
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Main config — shown when provisioned */}
        {config.enabled && !needsProvisioning && (
          <div className="space-y-5 pt-2">
            {/* Agent name */}
            <Field label="Agent name">
              <input
                className={inputCls}
                value={config.agent_name}
                onChange={(e) =>
                  update("agent_name", e.target.value || "AI Assistant")
                }
                placeholder="David Martin"
                disabled={!canEdit}
              />
            </Field>

            {/* Transfer */}
            <div className="space-y-3">
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

            {/* Advanced — collapsed by default */}
            <details className="group">
              <summary className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide cursor-pointer select-none">
                Advanced
              </summary>
              <div className="space-y-4 pt-3">
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-[var(--muted)]">
                    Call limits
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Max attempts">
                      <input
                        type="number"
                        className={inputCls}
                        value={config.max_attempts}
                        onChange={(e) =>
                          update(
                            "max_attempts",
                            parseInt(e.target.value) || 3
                          )
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
            </details>
          </div>
        )}
      </Panel>
    </div>
  );
});

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
