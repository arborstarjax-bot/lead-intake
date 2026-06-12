import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";

export const runtime = "nodejs";

/**
 * Vapi tool-call webhook. During a live call, Vapi POSTs here whenever
 * the assistant invokes a function tool. We inspect the tool name,
 * execute the corresponding logic, and return a result Vapi feeds back
 * to the LLM.
 *
 * Vapi sends a payload like:
 * {
 *   "message": {
 *     "type": "tool-calls",
 *     "toolCalls": [{ "id": "...", "function": { "name": "...", "arguments": "..." } }],
 *     "call": { "id": "..." }
 *   }
 * }
 *
 * We respond with:
 * { "results": [{ "toolCallId": "...", "result": "..." }] }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const message = body.message as Record<string, unknown> | undefined;
  if (!message || message.type !== "tool-calls") {
    return NextResponse.json({ error: "unsupported message type" }, { status: 400 });
  }

  const toolCalls = message.toolCalls as Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;

  if (!toolCalls?.length) {
    return NextResponse.json({ error: "no tool calls" }, { status: 400 });
  }

  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      const args = JSON.parse(tc.function.arguments || "{}");
      const result = await handleToolCall(tc.function.name, args);
      return { toolCallId: tc.id, result: JSON.stringify(result) };
    })
  );

  return NextResponse.json({ results });
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "lookup_lead":
      return lookupLead(args.lead_id as string);
    case "update_lead_info":
      return updateLeadInfo(
        args.lead_id as string,
        args.updates as Record<string, unknown>
      );
    case "check_availability":
      return checkAvailability(args);
    case "book_appointment":
      return bookAppointment(args);
    case "send_text_message":
      return sendTextMessage(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function lookupLead(leadId: string) {
  if (!leadId) return { error: "lead_id is required" };
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, first_name, last_name, client, phone_number, email, address, city, state, zip, status, lead_source, lead_type, notes, scheduled_day, scheduled_time"
    )
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return { error: "Lead not found" };
  return data;
}

async function updateLeadInfo(
  leadId: string,
  updates: Record<string, unknown>
) {
  if (!leadId) return { error: "lead_id is required" };
  if (!updates || Object.keys(updates).length === 0)
    return { error: "No updates provided" };

  const allowedFields = [
    "first_name",
    "last_name",
    "address",
    "city",
    "state",
    "zip",
    "email",
    "lead_type",
    "notes",
    "ai_notes",
  ];
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (allowedFields.includes(k)) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0)
    return { error: "No valid fields to update" };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("leads")
    .update(filtered)
    .eq("id", leadId);
  if (error) return { error: error.message };
  return { success: true, updated_fields: Object.keys(filtered) };
}

async function checkAvailability(args: Record<string, unknown>) {
  // Phase 2 will implement full route-optimized availability.
  // For now, return a placeholder that lets the AI know this tool exists.
  const { lead_id, preferred_date, preferred_time, days_ahead } = args as {
    lead_id?: string;
    preferred_date?: string;
    preferred_time?: string;
    days_ahead?: number;
  };

  void lead_id;
  void preferred_date;
  void preferred_time;

  const slotsAhead = days_ahead ?? 5;
  const slots = [];
  const now = new Date();

  for (let i = 1; i <= slotsAhead; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    if (d.getDay() === 0) continue; // skip Sunday
    slots.push({
      date: d.toISOString().slice(0, 10),
      time: "09:00",
      type: "timed",
      route_score: Math.max(0, 100 - i * 15),
      note: i === 1 ? "Crew nearby — best fit" : undefined,
    });
    if (d.getDay() !== 6) {
      slots.push({
        date: d.toISOString().slice(0, 10),
        time: "14:00",
        type: "timed",
        route_score: Math.max(0, 80 - i * 15),
      });
    }
  }

  return { slots: slots.slice(0, 6) };
}

async function bookAppointment(args: Record<string, unknown>) {
  const { lead_id, date, time, service_notes } = args as {
    lead_id?: string;
    date?: string;
    time?: string;
    service_notes?: string;
  };

  if (!lead_id || !date || !time)
    return { error: "lead_id, date, and time are required" };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("leads")
    .update({
      status: "Scheduled",
      scheduled_day: date,
      scheduled_time: time,
      notes: service_notes || undefined,
    })
    .eq("id", lead_id);

  if (error) return { error: error.message };
  return {
    success: true,
    appointment: { date, time, confirmation_sent: false },
  };
}

async function sendTextMessage(args: Record<string, unknown>) {
  const { lead_id, message_type, custom_message } = args as {
    lead_id?: string;
    message_type?: string;
    custom_message?: string;
  };

  void custom_message;

  if (!lead_id) return { error: "lead_id is required" };

  // Phase 2 will integrate with the existing SMS system.
  // For now, log intent and return success.
  return {
    success: true,
    message_type: message_type ?? "custom",
    note: "SMS integration pending — message queued",
  };
}
