import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { MapsUnavailableError, createDriveMemo } from "@/modules/routing/server";
import {
  parseHHMM,
  formatHHMM,
  leadAddressString,
  suggestSlots,
  smartBookSlots,
  calculateRouteScore,
  type ExistingStop,
  type SmartBookingMode,
} from "@/modules/schedule/server";
import {
  canSchedule,
  createCalendarEvent,
  isPendingCalendarClaim,
  realCalendarEventId,
  updateCalendarEvent,
  getAccessToken,
} from "@/modules/calendar/server";
import type { Lead } from "@/modules/leads/model";
import {
  todayIsoInBusinessTz,
  isoInBusinessTz,
  dayOfWeekInBusinessTz,
  upcomingBusinessTzDays,
} from "@/modules/shared/date";

/**
 * Shared schedule handlers. Both /api/schedule/* (session) and /api/v1/schedule/*
 * (session or Bearer key) call these — one code path, two transports.
 * Each returns `{ status, body }`; routes map it to a NextResponse.
 */

export type HandlerResult = { status: number; body: Record<string, unknown> };
const R = (status: number, body: Record<string, unknown>): HandlerResult => ({ status, body });

// ---------- Day route ----------

export type RouteStop = {
  id: string;
  label: string;
  address: string;
  startTime: string;
  endTime: string;
  driveMinutesFromPrev: number | null;
};

export async function dayRoute(workspaceId: string, iso: string): Promise<HandlerResult> {
  const supabase = createAdminClient();
  const settings = await getSettings(workspaceId);

  const rowsResp = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_day", iso)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .order("scheduled_time", { ascending: true });
  if (rowsResp.error) return R(500, { error: rowsResp.error.message });
  const leads = (rowsResp.data ?? []) as unknown as Lead[];

  const blockSize = settings.min_time_between_appointments || 60;
  const stopsInput = leads
    .map((l) => {
      const addr = leadAddressString(l);
      const time = l.scheduled_time;
      if (!addr || !time) return null;
      const startMin = parseHHMM(time);
      return {
        id: l.id,
        label:
          l.client?.trim() ||
          `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
          "Scheduled job",
        address: addr,
        startMin,
        endMin: startMin + blockSize,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const home = homeAddressString(settings);
  const hasMapsKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);

  if (!home || !hasMapsKey || stopsInput.length === 0) {
    const stops: RouteStop[] = stopsInput.map((s) => ({
      id: s.id,
      label: s.label,
      address: s.address,
      startTime: formatHHMM(s.startMin),
      endTime: formatHHMM(s.endMin),
      driveMinutesFromPrev: null,
    }));
    return R(200, {
      hasHome: false,
      date: iso,
      stops,
      totalDriveMinutes: 0,
      returnDriveMinutes: null,
    });
  }

  const drive = createDriveMemo();
  try {
    const legs: number[] = [];
    for (let i = 0; i < stopsInput.length; i++) {
      const from = i === 0 ? home : stopsInput[i - 1].address;
      const res = await drive(from, stopsInput[i].address);
      legs.push(Math.round(res.drive_seconds / 60));
    }
    const returnLeg = await drive(stopsInput[stopsInput.length - 1].address, home);
    const returnMinutes = Math.round(returnLeg.drive_seconds / 60);
    const stops: RouteStop[] = stopsInput.map((s, i) => ({
      id: s.id,
      label: s.label,
      address: s.address,
      startTime: formatHHMM(s.startMin),
      endTime: formatHHMM(s.endMin),
      driveMinutesFromPrev: legs[i],
    }));
    return R(200, {
      hasHome: true,
      date: iso,
      stops,
      totalDriveMinutes: legs.reduce((a, b) => a + b, 0) + returnMinutes,
      returnDriveMinutes: returnMinutes,
    });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      const stops: RouteStop[] = stopsInput.map((s) => ({
        id: s.id,
        label: s.label,
        address: s.address,
        startTime: formatHHMM(s.startMin),
        endTime: formatHHMM(s.endMin),
        driveMinutesFromPrev: null,
      }));
      return R(200, {
        hasHome: false,
        date: iso,
        stops,
        totalDriveMinutes: 0,
        returnDriveMinutes: null,
      });
    }
    return R(500, { error: (e as Error).message });
  }
}

// ---------- Shared lead/day loading ----------

async function loadLeadAndSettings(workspaceId: string, leadId: string) {
  const supabase = createAdminClient();
  const [leadResp, settings] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    getSettings(workspaceId),
  ]);
  if (leadResp.error || !leadResp.data) return { error: R(404, { error: "Lead not found" }) };
  return { lead: leadResp.data as Lead, settings, supabase };
}

async function sameDayLeads(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  day: string,
  excludeId?: string
) {
  let q = supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_day", day)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed");
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) return { error };
  return { leads: (data ?? []) as unknown as Lead[] };
}

// ---------- Week preview ----------

export const weekPreviewSchema = z
  .object({
    leadId: z.string().uuid(),
    horizonDays: z.number().int().min(1).max(30).default(14),
  })
  .strict();
export type WeekPreviewInput = z.infer<typeof weekPreviewSchema>;

function normalizeZip(z2: string | null | undefined): string | null {
  if (!z2) return null;
  const digits = z2.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

function computeClusterBonus(newZip: string | null, sameDayLeads: Lead[]): number {
  if (!newZip) return 0;
  const zip3 = newZip.slice(0, 3);
  let bonus = 0;
  for (const other of sameDayLeads) {
    const otherZip = normalizeZip(other.zip);
    if (!otherZip) continue;
    if (otherZip === newZip) bonus += 5;
    else if (otherZip.slice(0, 3) === zip3) bonus += 2;
  }
  return Math.min(15, bonus);
}

const URGENCY_PENALTY_PER_DAY = 2;
const URGENCY_PENALTY_CAP = 20;

export async function weekPreview(
  workspaceId: string,
  input: WeekPreviewInput
): Promise<HandlerResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return R(503, {
      error: "AI scheduling needs a Google Maps API key. Add GOOGLE_MAPS_API_KEY on Vercel and redeploy.",
    });
  }
  const loaded = await loadLeadAndSettings(workspaceId, input.leadId);
  if ("error" in loaded && loaded.error) return loaded.error as HandlerResult;
  const { lead, settings, supabase } = loaded as Exclude<typeof loaded, { error: HandlerResult }>;

  if (!homeAddressString(settings)) {
    return R(400, { error: "Set your starting address in Settings before using the AI scheduler." });
  }
  if (!leadAddressString(lead)) {
    return R(400, { error: "This lead has no address yet — add one to rank days by drive time." });
  }

  const tz = settings.timezone;
  const days = upcomingBusinessTzDays(input.horizonDays, tz);
  const startIso = isoInBusinessTz(days[0], tz);
  const endIso = isoInBusinessTz(days[days.length - 1], tz);

  const { data: window, error: windowErr } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gte("scheduled_day", startIso)
    .lte("scheduled_day", endIso)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .neq("id", lead.id);
  if (windowErr) return R(500, { error: windowErr.message });

  const byDay = new Map<string, Lead[]>();
  for (const row of (window ?? []) as unknown as Lead[]) {
    if (!row.scheduled_day) continue;
    const list = byDay.get(row.scheduled_day) ?? [];
    list.push(row);
    byDay.set(row.scheduled_day, list);
  }

  const drive = createDriveMemo();
  const workDays = new Set(settings.work_days);
  const newLeadZip = normalizeZip(lead.zip);

  type DayPreview =
    | { date: string; isWorkDay: false }
    | {
        date: string;
        isWorkDay: true;
        bestTotalDriveMinutes: number | null;
        clusterBonusMinutes: number;
        effectiveBestMinutes: number | null;
        slotCount: number;
        routeScore: number;
      };

  try {
    const results = await Promise.all(
      days.map(async (d): Promise<DayPreview> => {
        const iso = isoInBusinessTz(d, tz);
        const dow = dayOfWeekInBusinessTz(d, tz);
        if (!workDays.has(dow)) return { date: iso, isWorkDay: false };
        const others = byDay.get(iso) ?? [];
        const { slots } = await suggestSlots({ lead, settings, others, half: "all", drive });

        const todayIso = todayIsoInBusinessTz(tz);
        let feasible = slots;
        if (iso === todayIso) {
          const nowHHMM = new Date().toLocaleTimeString("en-US", {
            timeZone: tz,
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
          });
          feasible = slots.filter((s) => s.startTime > nowHHMM);
        }

        const best = feasible.length
          ? Math.min(...feasible.map((s) => s.totalDriveMinutes))
          : null;
        const clusterBonusMinutes = computeClusterBonus(newLeadZip, others);
        const daysOut = Math.round((d.getTime() - days[0].getTime()) / (1000 * 60 * 60 * 24));
        const urgencyPenalty = Math.min(daysOut * URGENCY_PENALTY_PER_DAY, URGENCY_PENALTY_CAP);
        const effectiveBestMinutes =
          best == null ? null : Math.max(0, best - clusterBonusMinutes + urgencyPenalty);

        const homeAddr = homeAddressString(settings);
        let routeScore = 50;
        if (homeAddr) {
          const blockSize = settings.min_time_between_appointments || 60;
          const existingStops: ExistingStop[] = others
            .filter((o) => leadAddressString(o) && o.scheduled_time)
            .map((o) => ({
              id: o.id,
              label: o.client?.trim() || "job",
              address: leadAddressString(o)!,
              startMin: parseHHMM(o.scheduled_time!),
              endMin: parseHHMM(o.scheduled_time!) + blockSize,
            }));
          routeScore = await calculateRouteScore(drive, homeAddr, existingStops);
        }

        return {
          date: iso,
          isWorkDay: true,
          bestTotalDriveMinutes: best,
          clusterBonusMinutes,
          effectiveBestMinutes,
          slotCount: feasible.length,
          routeScore,
        };
      })
    );
    return R(200, { days: results });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return R(502, { error: `Google Maps: ${e.message}`, code: e.code });
    }
    return R(500, { error: (e as Error).message });
  }
}

// ---------- Suggest slots ----------

export const suggestSchema = z
  .object({
    leadId: z.string().uuid(),
    half: z.enum(["morning", "afternoon", "all"]).default("all"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD").optional(),
    offset: z.number().int().min(0).max(20).default(0),
  })
  .strict();
export type SuggestInput = z.infer<typeof suggestSchema>;

export async function suggest(workspaceId: string, input: SuggestInput): Promise<HandlerResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return R(503, {
      error: "AI scheduling needs a Google Maps API key. Add GOOGLE_MAPS_API_KEY on Vercel and redeploy.",
    });
  }
  const loaded = await loadLeadAndSettings(workspaceId, input.leadId);
  if ("error" in loaded && loaded.error) return loaded.error as HandlerResult;
  const { lead, settings, supabase } = loaded as Exclude<typeof loaded, { error: HandlerResult }>;

  const targetDay = input.day ?? lead.scheduled_day;
  if (!targetDay) {
    return R(400, { error: "This lead needs a scheduled day before ranking slots." });
  }
  const todayIso = todayIsoInBusinessTz(settings.timezone);
  if (targetDay < todayIso) {
    return R(400, { error: "That day is in the past — pick a future date." });
  }

  const same = await sameDayLeads(supabase, workspaceId, targetDay, lead.id);
  if (same.error) return R(500, { error: same.error.message });

  try {
    const { slots, warnings, hasMore, totalCount } = await suggestSlots({
      lead,
      settings,
      others: same.leads!,
      half: input.half,
      offset: input.offset,
    });
    return R(200, { slots, warnings, hasMore, totalCount });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return R(502, { error: `Google Maps: ${e.message}`, code: e.code });
    }
    return R(500, { error: (e as Error).message });
  }
}

// ---------- Smart book ----------

export const smartBookSchema = z
  .object({
    leadId: z.string().uuid(),
    mode: z.enum(["balanced", "best_route", "soonest"]).default("balanced"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD").optional(),
  })
  .strict();
export type SmartBookInput = z.infer<typeof smartBookSchema>;

export async function smartBook(workspaceId: string, input: SmartBookInput): Promise<HandlerResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return R(503, {
      error: "AI scheduling needs a Google Maps API key. Add GOOGLE_MAPS_API_KEY on Vercel and redeploy.",
    });
  }
  const loaded = await loadLeadAndSettings(workspaceId, input.leadId);
  if ("error" in loaded && loaded.error) return loaded.error as HandlerResult;
  const { lead, settings, supabase } = loaded as Exclude<typeof loaded, { error: HandlerResult }>;

  const targetDay = input.day ?? lead.scheduled_day;
  if (!targetDay) {
    return R(400, { error: "This lead needs a scheduled day before ranking slots." });
  }
  const todayIso = todayIsoInBusinessTz(settings.timezone);
  if (targetDay < todayIso) {
    return R(400, { error: "That day is in the past — pick a future date." });
  }

  const todayDate = new Date(todayIso + "T12:00:00Z");
  const targetDate = new Date(targetDay + "T12:00:00Z");
  const calendarDaysOut = Math.round((targetDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  const workDays = new Set(settings.work_days);
  let workingDaysOut = 0;
  for (let i = 1; i <= calendarDaysOut; i++) {
    const d = new Date(todayDate);
    d.setUTCDate(d.getUTCDate() + i);
    if (workDays.has(d.getUTCDay())) workingDaysOut++;
  }

  const same = await sameDayLeads(supabase, workspaceId, targetDay, lead.id);
  if (same.error) return R(500, { error: same.error.message });
  const drive = createDriveMemo();

  try {
    const result = await smartBookSlots({
      lead,
      settings,
      others: same.leads!,
      mode: input.mode as SmartBookingMode,
      workingDaysOut,
      day: targetDay,
      drive,
    });

    if (targetDay === todayIso) {
      const nowHHMM = new Date().toLocaleTimeString("en-US", {
        timeZone: settings.timezone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      result.allSlots = result.allSlots.filter((s) => s.startTime > nowHHMM);
      result.morningTop3 = result.morningTop3.filter((s) => s.startTime > nowHHMM);
      result.afternoonTop3 = result.afternoonTop3.filter((s) => s.startTime > nowHHMM);
      if (result.bestOverall && result.bestOverall.startTime <= nowHHMM) {
        result.bestOverall = result.allSlots[0] ?? null;
      }
    }
    return R(200, result as unknown as Record<string, unknown>);
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return R(502, { error: `Google Maps: ${e.message}`, code: e.code });
    }
    return R(500, { error: (e as Error).message });
  }
}

// ---------- Reorder ----------

export const reorderSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    orderedLeadIds: z.array(z.string().uuid()).min(1),
    sync: z.boolean().optional().default(true),
  })
  .strict();
export type ReorderInput = z.infer<typeof reorderSchema>;

const normalizeTime = (t: string | null): string | null => {
  if (!t) return null;
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  return m ? `${m[1]}:${m[2]}` : t;
};

export async function reorderDay(
  workspaceId: string,
  userId: string | null,
  input: ReorderInput
): Promise<HandlerResult> {
  const supabase = createAdminClient();
  const [settings, rowsResp] = await Promise.all([
    getSettings(workspaceId),
    supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("scheduled_day", input.date)
      .not("scheduled_time", "is", null)
      .neq("status", "Completed"),
  ]);
  if (rowsResp.error) return R(500, { error: rowsResp.error.message });

  const home = homeAddressString(settings);
  if (!home) {
    return R(400, { error: "Set your starting address in Settings before reordering." });
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return R(503, { error: "GOOGLE_MAPS_API_KEY is not set." });
  }

  const allLeads = (rowsResp.data ?? []) as unknown as Lead[];
  const leadsById = new Map(allLeads.map((l) => [l.id, l]));

  const orderedIds = input.orderedLeadIds;
  if (orderedIds.length !== allLeads.length) {
    return R(409, {
      error: `Order is stale: expected ${allLeads.length} stops, got ${orderedIds.length}. Reload and try again.`,
    });
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    return R(409, { error: "Order contains duplicate leads. Reload and try again." });
  }
  for (const id of orderedIds) {
    if (!leadsById.has(id)) {
      return R(409, { error: "Order contains a lead not on this day. Reload and try again." });
    }
  }

  const orderedLeads = orderedIds.map((id) => leadsById.get(id)!);
  for (const l of orderedLeads) {
    if (!leadAddressString(l)) {
      const name =
        l.client?.trim() || `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.id;
      return R(400, { error: `"${name}" has no address — add one before reordering.` });
    }
  }

  const drive = createDriveMemo();
  const workStart = parseHHMM(settings.work_start_time);
  const workEnd = parseHHMM(settings.work_end_time);
  const duration = settings.default_job_minutes;
  const buffer = settings.travel_buffer_minutes;

  const SLOT_STEP = 30;
  const snapUp = (min: number) => Math.ceil(min / SLOT_STEP) * SLOT_STEP;

  const newTimes: { id: string; newMin: number }[] = [];
  let prevEnd = workStart;
  let prevAddr = home;
  try {
    for (const lead of orderedLeads) {
      const addr = leadAddressString(lead)!;
      const leg = await drive(prevAddr, addr);
      const driveMin = Math.ceil(leg.drive_seconds / 60);
      const earliest = Math.max(workStart, prevEnd + buffer + driveMin);
      const startMin = snapUp(earliest);
      newTimes.push({ id: lead.id, newMin: startMin });
      prevEnd = startMin + duration;
      prevAddr = addr;
    }
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return R(502, { error: `Google: ${e.message}`, code: e.code });
    }
    return R(500, { error: (e as Error).message });
  }

  const lastEnd = newTimes.length > 0 ? newTimes[newTimes.length - 1].newMin + duration : workStart;
  const overflowMinutes = Math.max(0, lastEnd - workEnd);

  const shifted: { lead: Lead; newTime: string; oldTime: string | null }[] = [];
  for (const { id, newMin } of newTimes) {
    const lead = leadsById.get(id)!;
    const newTime = formatHHMM(newMin);
    const oldTime = lead.scheduled_time;
    if (oldTime === newTime || oldTime === `${newTime}:00`) continue;
    const { error: upErr } = await supabase
      .from("leads")
      .update({ scheduled_time: newTime })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (upErr) {
      return R(500, { error: `Failed to update time for lead ${id}: ${upErr.message}` });
    }
    shifted.push({ lead: { ...lead, scheduled_time: newTime }, newTime, oldTime });
  }

  type PerLeadResult = {
    leadId: string;
    label: string;
    oldTime: string | null;
    newTime: string;
    calendar: "already" | "created" | "updated" | "skipped" | "error" | "off";
    calendarError?: string;
  };

  const results: PerLeadResult[] = [];
  const token = input.sync && userId ? await getAccessToken(userId) : null;
  for (const { id, newMin } of newTimes) {
    const lead = leadsById.get(id)!;
    const newTime = formatHHMM(newMin);
    const oldTime = lead.scheduled_time;
    const label =
      lead.client?.trim() ||
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      "Scheduled job";

    if (!input.sync || !token) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: input.sync ? "off" : "skipped" });
      continue;
    }

    const leadNext: Lead = { ...lead, scheduled_time: newTime };
    if (!canSchedule(leadNext) || isPendingCalendarClaim(lead.calendar_event_id)) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: "skipped" });
      continue;
    }

    const realEventId = realCalendarEventId(lead.calendar_event_id);
    const unchanged =
      normalizeTime(oldTime) === newTime &&
      realEventId &&
      lead.calendar_scheduled_day === input.date &&
      normalizeTime(lead.calendar_scheduled_time) === newTime;
    if (unchanged) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: "already" });
      continue;
    }

    try {
      const event = realEventId
        ? await updateCalendarEvent(token, realEventId, leadNext, settings.timezone)
        : await createCalendarEvent(token, leadNext, settings.timezone);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: input.date,
          calendar_scheduled_time: newTime,
          status: lead.status === "Completed" ? "Completed" : "Scheduled",
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      results.push({ leadId: id, label, oldTime, newTime, calendar: realEventId ? "updated" : "created" });
    } catch (e) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: "error", calendarError: (e as Error).message });
    }
  }

  return R(200, {
    shifted: shifted.length,
    overflowMinutes,
    calendarConnected: Boolean(token),
    results: results as unknown as Record<string, unknown>[],
  });
}

// ---------- Sync day to Google Calendar ----------

export const syncDaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  })
  .strict();
export type SyncDayInput = z.infer<typeof syncDaySchema>;

export async function syncDay(
  workspaceId: string,
  userId: string | null,
  input: SyncDayInput
): Promise<HandlerResult> {
  if (!userId) {
    return R(428, {
      error: "Calendar sync needs a signed-in user — API keys can't reach Google Calendar.",
    });
  }
  const token = await getAccessToken(userId);
  if (!token) {
    return R(428, { error: "Google Calendar not connected", connectUrl: "/api/google/connect" });
  }

  const supabase = createAdminClient();
  const settings = await getSettings(workspaceId);
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scheduled_day", input.date)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .order("scheduled_time", { ascending: true });
  if (error) return R(500, { error: error.message });
  const leads = (data ?? []) as unknown as Lead[];

  type PerLeadResult = {
    leadId: string;
    label: string;
    status: "already" | "created" | "updated" | "skipped" | "error";
    error?: string;
  };
  const results: PerLeadResult[] = [];
  for (const lead of leads) {
    const label =
      lead.client?.trim() ||
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      "Scheduled job";
    if (!canSchedule(lead) || isPendingCalendarClaim(lead.calendar_event_id)) {
      results.push({ leadId: lead.id, label, status: "skipped" });
      continue;
    }
    const desiredDay = lead.scheduled_day;
    const desiredTime = normalizeTime(lead.scheduled_time);
    const syncedDay = lead.calendar_scheduled_day;
    const syncedTime = normalizeTime(lead.calendar_scheduled_time);
    const realEventId = realCalendarEventId(lead.calendar_event_id);
    if (realEventId && syncedDay === desiredDay && syncedTime === desiredTime) {
      results.push({ leadId: lead.id, label, status: "already" });
      continue;
    }

    const nextStatus: Lead["status"] = lead.status === "Completed" ? "Completed" : "Scheduled";
    const leadForEvent: Lead = { ...lead, status: nextStatus };
    try {
      const event = realEventId
        ? await updateCalendarEvent(token, realEventId, leadForEvent, settings.timezone)
        : await createCalendarEvent(token, leadForEvent, settings.timezone);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: desiredDay,
          calendar_scheduled_time: desiredTime,
          status: nextStatus,
        })
        .eq("id", lead.id)
        .eq("workspace_id", workspaceId);
      results.push({ leadId: lead.id, label, status: realEventId ? "updated" : "created" });
    } catch (e) {
      results.push({ leadId: lead.id, label, status: "error", error: (e as Error).message });
    }
  }

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    already: results.filter((r) => r.status === "already").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  return R(200, { results: results as unknown as Record<string, unknown>[], summary });
}
