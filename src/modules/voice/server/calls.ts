import "server-only";
import { createAdminClient } from "@/modules/shared/supabase/server";

export type AiCall = {
  id: string;
  workspace_id: string;
  lead_id: string;
  campaign_id: string | null;
  vapi_call_id: string | null;
  direction: string;
  from_number: string | null;
  to_number: string;
  status: string;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  attempt_number: number;
  call_summary: string | null;
  call_sentiment: string | null;
  lead_qualified: boolean | null;
  service_needed: string | null;
  info_gathered: Record<string, unknown> | null;
  appointment_booked: boolean;
  recording_url: string | null;
  transcript: Array<{ role: string; content: string; timestamp?: number }> | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AiCallInsert = Pick<
  AiCall,
  "workspace_id" | "lead_id" | "to_number"
> &
  Partial<
    Pick<
      AiCall,
      | "campaign_id"
      | "vapi_call_id"
      | "direction"
      | "from_number"
      | "status"
      | "attempt_number"
    >
  >;

export async function insertCall(insert: AiCallInsert): Promise<AiCall> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_calls")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw new Error(`Insert ai_call failed: ${error.message}`);
  return data as AiCall;
}

export async function updateCall(
  callId: string,
  patch: Partial<AiCall>
): Promise<AiCall> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_calls")
    .update(patch)
    .eq("id", callId)
    .select("*")
    .single();
  if (error) throw new Error(`Update ai_call failed: ${error.message}`);
  return data as AiCall;
}

export async function getCallByVapiId(
  vapiCallId: string
): Promise<AiCall | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_calls")
    .select("*")
    .eq("vapi_call_id", vapiCallId)
    .maybeSingle();
  return (data as AiCall | null) ?? null;
}

export async function getCallsForLead(leadId: string): Promise<AiCall[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_calls")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  return (data as AiCall[]) ?? [];
}

export async function getActiveCallCount(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  // Only count calls created within the last 10 minutes as "active".
  // Calls stuck longer than that are stale (status webhook missed).
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("ai_calls")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "ringing", "in_progress"])
    .gte("created_at", tenMinAgo);
  return count ?? 0;
}
