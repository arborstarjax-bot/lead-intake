import "server-only";
import { createAdminClient } from "@/modules/shared/supabase/server";

export type VoiceAgentConfig = {
  id: string;
  workspace_id: string;
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
  voice_cloned: boolean;
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
  created_at: string;
  updated_at: string;
};

export type VoiceAgentConfigPatch = Partial<
  Omit<VoiceAgentConfig, "id" | "workspace_id" | "created_at" | "updated_at">
>;

export function defaultVoiceConfig(workspaceId: string): VoiceAgentConfig {
  const now = new Date().toISOString();
  return {
    id: "",
    workspace_id: workspaceId,
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
    voice_cloned: false,
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
    created_at: now,
    updated_at: now,
  };
}

export async function getVoiceConfig(
  workspaceId: string
): Promise<VoiceAgentConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voice_agent_config")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return defaultVoiceConfig(workspaceId);
  return { ...defaultVoiceConfig(workspaceId), ...(data as Partial<VoiceAgentConfig>) };
}

export async function upsertVoiceConfig(
  workspaceId: string,
  patch: VoiceAgentConfigPatch
): Promise<VoiceAgentConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voice_agent_config")
    .upsert(
      { workspace_id: workspaceId, ...patch },
      { onConflict: "workspace_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(`Upsert voice config failed: ${error.message}`);
  return { ...defaultVoiceConfig(workspaceId), ...(data as Partial<VoiceAgentConfig>) };
}
