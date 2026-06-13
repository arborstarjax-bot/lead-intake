import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings } from "@/lib/settings";
import { suggestSlots, formatClock } from "@/modules/schedule/server";
import { sendWorkspacePush } from "@/lib/push";
import type { Lead } from "@/modules/leads/model";
import {
  todayIsoInBusinessTz,
  addDaysToBusinessTzIso,
  dateAtBusinessTzDay,
  dayOfWeekInBusinessTz,
} from "@/modules/shared/date";

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
    function: { name: string; arguments: string | Record<string, unknown> };
  }>;

  if (!toolCalls?.length) {
    return NextResponse.json({ error: "no tool calls" }, { status: 400 });
  }

  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      try {
        // Vapi may send arguments as a JSON string OR as an already-parsed object
        const raw = tc.function.arguments;
        const args =
          typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
        const result = await handleToolCall(tc.function.name, args);
        return { toolCallId: tc.id, result: JSON.stringify(result) };
      } catch (e) {
        return {
          toolCallId: tc.id,
          result: JSON.stringify({ error: (e as Error).message }),
        };
      }
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

  // Run both queries in parallel for faster response
  const [leadResult, callsResult] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, first_name, last_name, client, phone_number, email, address, city, state, zip, status, lead_source, lead_type, notes, scheduled_day, scheduled_time, flex_window, ai_call_count, ai_last_call_at, ai_last_call_status, ai_do_not_call, ai_notes, sales_person, created_at"
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("ai_calls")
      .select("status, call_summary, appointment_booked, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  if (leadResult.error || !leadResult.data) return { error: "Lead not found" };
  const data = leadResult.data;

  return {
    ...data,
    recent_calls: callsResult.data ?? [],
    context: {
      has_been_called_before: (data.ai_call_count ?? 0) > 0,
      is_already_scheduled: data.status === "Scheduled",
      has_address: Boolean(data.address),
      days_since_created: Math.floor(
        (Date.now() - new Date(data.created_at).getTime()) / 86400000
      ),
    },
  };
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

  // Auto-detect DNC request from ai_notes
  const aiNotes = (filtered.ai_notes as string) ?? "";
  if (
    aiNotes.toUpperCase().includes("DO NOT CALL") ||
    aiNotes.toUpperCase().includes("DNC") ||
    aiNotes.toUpperCase().includes("REQUESTED REMOVAL")
  ) {
    (filtered as Record<string, unknown>).ai_do_not_call = true;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("leads")
    .update(filtered)
    .eq("id", leadId);
  if (error) return { error: error.message };
  return { success: true, updated_fields: Object.keys(filtered) };
}

async function checkAvailability(args: Record<string, unknown>) {
  const { lead_id, preferred_date, preferred_time, days_ahead } = args as {
    lead_id?: string;
    preferred_date?: string;
    preferred_time?: string;
    days_ahead?: number;
  };

  if (!lead_id) return { error: "lead_id is required" };

  const supabase = createAdminClient();

  // Get the lead + its workspace
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("*")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return { error: "Lead not found" };

  const workspaceId = lead.workspace_id as string;
  const settings = await getSettings(workspaceId);

  const half =
    preferred_time === "morning"
      ? "morning"
      : preferred_time === "afternoon"
        ? "afternoon"
        : "all";

  // Determine which days to check (default 3 for speed — AI only needs 1-2 good slots)
  const tz = settings.timezone;
  const todayIso = todayIsoInBusinessTz(tz);
  const daysToCheck = days_ahead ?? 3;
  const daysList: string[] = [];

  if (preferred_date) {
    // Customer asked for a specific date — validate it's a work day
    if (preferred_date >= todayIso) {
      const pd = dateAtBusinessTzDay(preferred_date);
      const pdow = dayOfWeekInBusinessTz(pd, tz);
      if (settings.work_days.includes(pdow)) {
        daysList.push(preferred_date);
      } else {
        return {
          error: `${preferred_date} is not a work day. Work days are: ${settings.work_days.map((n: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n]).join(", ")}. Please suggest a different day.`,
          slots: [],
        };
      }
    }
  } else {
    // Find the next N work days
    let offset = 1; // start from tomorrow
    while (daysList.length < daysToCheck && offset <= 14) {
      const candidate = addDaysToBusinessTzIso(todayIso, offset, tz);
      const d = dateAtBusinessTzDay(candidate);
      const dow = dayOfWeekInBusinessTz(d, tz);
      if (settings.work_days.includes(dow)) {
        daysList.push(candidate);
      }
      offset++;
    }
  }

  if (daysList.length === 0) {
    return { error: "No valid work days found in the requested range." };
  }

  // For each day, use the real suggestSlots to get route-optimized options
  // Process all days IN PARALLEL for much faster response
  type SlotResult = {
    date: string;
    display_date: string;
    time: string;
    display_time: string;
    drive_minutes: number;
    route_score: number;
    context: string;
  };

  const dayResults = await Promise.all(
    daysList.map(async (day): Promise<SlotResult[]> => {
      const { data: sameDay } = await supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("scheduled_day", day)
        .not("scheduled_time", "is", null)
        .neq("status", "Completed")
        .neq("id", lead.id);

      const leadWithDay = { ...lead, scheduled_day: day } as Lead;
      try {
        const { slots, warnings } = await suggestSlots({
          lead: leadWithDay,
          settings,
          others: (sameDay ?? []) as Lead[],
          half,
        });

        if (warnings.length && slots.length === 0) return [];

        const existing = sameDay?.length ?? 0;
        const dayName = new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        return slots.map((slot) => ({
          date: day,
          display_date: dayName,
          time: slot.startTime,
          display_time: formatClock(
            parseInt(slot.startTime.split(":")[0]) * 60 +
              parseInt(slot.startTime.split(":")[1])
          ),
          drive_minutes: slot.driveMinutesBefore,
          route_score: Math.max(0, 100 - slot.totalDriveMinutes * 2),
          context:
            existing > 0
              ? `${existing} other estimate${existing > 1 ? "s" : ""} already on this day — fits route`
              : "Open day — first estimate",
        }));
      } catch {
        // Fallback to basic time-gap availability
        const { data: sameDayBasic } = await supabase
          .from("leads")
          .select("scheduled_time")
          .eq("workspace_id", workspaceId)
          .eq("scheduled_day", day)
          .not("scheduled_time", "is", null)
          .neq("status", "Completed");

        const takenTimes = (sameDayBasic ?? []).map(
          (l) => l.scheduled_time as string
        );
        const workStart = settings.work_start_time;
        const workEnd = settings.work_end_time;
        const minGap = settings.min_time_between_appointments;
        const wsMin =
          parseInt(workStart.split(":")[0]) * 60 +
          parseInt(workStart.split(":")[1]);
        const weMin =
          parseInt(workEnd.split(":")[0]) * 60 +
          parseInt(workEnd.split(":")[1]);

        const daySlots: SlotResult[] = [];
        for (let m = wsMin; m + minGap <= weMin; m += 30) {
          const timeStr = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const hasConflict = takenTimes.some((t) => {
            const tMin =
              parseInt(t.split(":")[0]) * 60 + parseInt(t.split(":")[1]);
            return Math.abs(m - tMin) < minGap;
          });
          if (hasConflict) continue;
          if (half === "morning" && m >= 12 * 60) continue;
          if (half === "afternoon" && m < 12 * 60) continue;

          daySlots.push({
            date: day,
            display_date: new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
            time: timeStr,
            display_time: formatClock(m),
            drive_minutes: 0,
            route_score: 50,
            context: "Basic availability (route optimization unavailable)",
          });
        }
        return daySlots;
      }
    })
  );

  const allSlots = dayResults.flat();

  // Sort by route_score descending, take top 5 (AI offers 1 at a time, has fallbacks)
  allSlots.sort((a, b) => b.route_score - a.route_score);
  const best = allSlots.slice(0, 5);

  const windowStart = formatClock(
    parseInt(settings.work_start_time.split(":")[0]) * 60 +
      parseInt(settings.work_start_time.split(":")[1])
  );
  const windowEnd = formatClock(
    parseInt(settings.work_end_time.split(":")[0]) * 60 +
      parseInt(settings.work_end_time.split(":")[1])
  );
  const workDayNames = settings.work_days
    .map((n: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n])
    .join(", ");

  if (best.length === 0) {
    return {
      slots: [],
      appointment_window: `${windowStart}–${windowEnd}, ${workDayNames}`,
      message:
        "No available slots found in the next " +
        daysToCheck +
        " work days. All time slots are booked. " +
        `Our appointment window is ${windowStart} to ${windowEnd}, ${workDayNames}.`,
    };
  }

  return {
    slots: best,
    appointment_window: `${windowStart}–${windowEnd}, ${workDayNames}`,
    instructions:
      "Offer the highest route_score slot first. Use the display_date field for the day name (e.g. 'Monday, June 15'). " +
      "Say something like: 'We will be in your area on [display_date] — would [display_time] work for you?' " +
      "IMPORTANT: Always use the display_date from the slot data. Do NOT compute day names yourself. " +
      `Our full appointment window is ${windowStart} to ${windowEnd}. ` +
      `HARD LIMIT: Do NOT agree to any time before ${windowStart} or after ${windowEnd}. ` +
      "If the customer asks for a time outside this window, politely say: " +
      `'Our appointment times run from ${windowStart} to ${windowEnd} — would [closest time] work instead?' ` +
      "If the customer asks about other times WITHIN the window, any time within this window on a work day is valid — " +
      "these slots are just the BEST options based on route efficiency. " +
      "Do NOT tell the customer the window is smaller than it actually is.",
  };
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

  // Get the lead to find its workspace
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("workspace_id, client, first_name, last_name")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return { error: "Lead not found" };

  const workspaceId = lead.workspace_id as string;
  const settings = await getSettings(workspaceId);
  const minGap = settings.min_time_between_appointments;

  // Double-booking check — same logic as the leads/[id] PUT route
  const { data: sameDayLeads } = await supabase
    .from("leads")
    .select("id, client, first_name, last_name, scheduled_time")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_day", date)
    .not("scheduled_time", "is", null)
    .neq("id", lead_id)
    .not("status", "in", '("Completed","Lost","Pending")');

  const requestedMin =
    parseInt(time.split(":")[0]) * 60 + parseInt(time.split(":")[1]);
  const conflicts = (sameDayLeads ?? []).filter((c) => {
    if (!c.scheduled_time) return false;
    const otherMin =
      parseInt(c.scheduled_time.split(":")[0]) * 60 +
      parseInt(c.scheduled_time.split(":")[1]);
    return Math.abs(requestedMin - otherMin) < minGap;
  });

  if (conflicts.length > 0) {
    const first = conflicts[0];
    const label =
      (first.client ?? "").trim() ||
      [first.first_name, first.last_name].filter(Boolean).join(" ") ||
      "another appointment";
    return {
      error: `Time conflict: ${label} is already scheduled at ${first.scheduled_time} on ${date}. Need at least ${minGap} min gap. Please offer the customer a different time.`,
      conflicts: conflicts.map((c) => ({
        time: c.scheduled_time,
        label:
          (c.client ?? "").trim() ||
          [c.first_name, c.last_name].filter(Boolean).join(" "),
      })),
    };
  }

  // Validate the time is within working hours
  const wsMin =
    parseInt(settings.work_start_time.split(":")[0]) * 60 +
    parseInt(settings.work_start_time.split(":")[1]);
  const weMin =
    parseInt(settings.work_end_time.split(":")[0]) * 60 +
    parseInt(settings.work_end_time.split(":")[1]);
  if (requestedMin < wsMin || requestedMin >= weMin) {
    return {
      error: `Time ${time} is outside working hours (${settings.work_start_time}–${settings.work_end_time}). Please offer a time within working hours.`,
    };
  }

  // Validate the day is a work day
  const d = dateAtBusinessTzDay(date);
  const dow = dayOfWeekInBusinessTz(d, settings.timezone);
  if (!settings.work_days.includes(dow)) {
    return {
      error: `${date} is not a work day. Work days are: ${settings.work_days.map((n: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n]).join(", ")}. Please offer a different day.`,
    };
  }

  // All checks passed — book it
  const updatePayload: Record<string, unknown> = {
    status: "Scheduled",
    scheduled_day: date,
    scheduled_time: time,
    flex_window: null, // Clear any flex window — this is a pinned time
    ai_last_call_status: "booked",
    ai_last_call_at: new Date().toISOString(),
  };
  if (service_notes) {
    updatePayload.notes = service_notes;
  }

  const { error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", lead_id);

  if (error) return { error: error.message };

  // Send push notification for the booked appointment
  const clientName =
    (lead.client as string ?? "").trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
    "A lead";
  const displayTime = formatClock(requestedMin);
  const dateObj = new Date(date + "T12:00:00");
  const dayLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  sendWorkspacePush({
    workspaceId,
    title: "AI booked estimate",
    body: `${clientName} — ${dayLabel} at ${displayTime}`,
    url: `/leads?highlight=${lead_id}`,
    tag: "ai-booking",
  }).catch(() => {});

  return {
    success: true,
    appointment: {
      date,
      time,
      display_time: displayTime,
      status: "Scheduled",
      note: "Lead moved to Scheduled in Lead Flow. Estimate appointment confirmed.",
    },
  };
}

async function sendTextMessage(args: Record<string, unknown>) {
  const { lead_id, message_type } = args as {
    lead_id?: string;
    message_type?: string;
    custom_message?: string;
  };

  if (!lead_id) return { error: "lead_id is required" };

  // SMS sending is not yet configured (requires Twilio integration).
  // Return a clear message so the AI doesn't promise texts.
  return {
    success: false,
    message_type: message_type ?? "custom",
    note: "SMS sending is not configured yet. Do NOT tell the customer you are sending a text. Instead, let them know the appointment is confirmed and they can call back if anything changes.",
  };
}
