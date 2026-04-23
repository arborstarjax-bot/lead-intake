import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { requireMembership } from "@/modules/auth";
import { MapsUnavailableError, getDriveMatrix } from "@/modules/routing";
import { leadAddressString, parseHHMM, formatHHMM } from "@/modules/schedule";
import { getAccessToken } from "@/modules/calendar";
import {
  canSchedule,
  createCalendarEvent,
  isPendingCalendarClaim,
  realCalendarEventId,
  updateCalendarEvent,
} from "@/modules/calendar";
import type { Lead } from "@/modules/leads/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flex-aware Optimize.
 *
 * Premise: timed stops represent a promise to the customer and must not
 * move. Only flex-window leads (day pinned, time TBD) can be retimed.
 * This endpoint therefore solves an "insertion" problem, not a TSP:
 *
 *   Given a day's timed itinerary (home → t1 → t2 → ... → home, with
 *   fixed start times) and N flex leads, pick a start time + insertion
 *   slot for each flex lead that
 *     a) respects the flex window (AM = starts before 12:00, PM = at
 *        or after 12:00, all_day = anywhere within work hours),
 *     b) fits without bumping a later timed stop past its promised time,
 *     c) minimizes added driving (greedy cheapest-insertion).
 *
 * GET  → preview (placements + summary). No mutation.
 * POST → apply the previewed placements: set scheduled_time + clear
 *        flex_window on each lead, resync Google Calendar.
 */

// ─── Response + request schemas ───────────────────────────────────────────

type Placement = {
  leadId: string;
  label: string;
  startTime: string; // "HH:MM"
  flexWindow: "all_day" | "am" | "pm";
  /** insertAfter = id of the timed/flex stop the new lead lands after;
   *  null means the flex lead is the first stop of the day. Purely
   *  informational for the preview UI. */
  insertAfter: string | null;
  /** Extra driving minutes vs. not inserting this lead (drive[prev→flex]
   *  + drive[flex→next] − drive[prev→next]). Informational only. */
  addedDriveMinutes: number;
};

type OptimizeResponse = {
  date: string;
  placements: Placement[];
  /** Flex leads the optimizer could not place (no valid slot). */
  unplaced: { leadId: string; label: string; flexWindow: string; reason: string }[];
  /** Timed stops already on the day — echoed so the UI can render them
   *  alongside the proposed placements without a second fetch. */
  timedStops: { leadId: string; label: string; startTime: string }[];
  /** Total added driving across all placements, in minutes. */
  addedDriveMinutes: number;
  /** True when there's nothing to do (no flex leads on this day). */
  nothingToDo: boolean;
};

const applyBodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    placements: z
      .array(
        z.object({
          leadId: z.string().uuid(),
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
        })
      )
      .min(1),
    sync: z.boolean().optional().default(true),
  })
  .strict();

// ─── Shared helpers ───────────────────────────────────────────────────────

function validDate(d: string | null): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const NOON = parseHHMM("12:00");

// ─── GET: preview placements ──────────────────────────────────────────────

export async function GET(req: Request) {
  const iso = validDate(new URL(req.url).searchParams.get("date"));
  if (!iso) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const [settings, rowsResp] = await Promise.all([
    getSettings(auth.workspaceId),
    supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("scheduled_day", iso)
      .neq("status", "Completed"),
  ]);
  if (rowsResp.error) {
    return NextResponse.json(
      { error: rowsResp.error.message },
      { status: 500 }
    );
  }

  const home = homeAddressString(settings);
  if (!home) {
    return NextResponse.json(
      { error: "Set your starting address in Settings before optimizing." },
      { status: 400 }
    );
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY is not set." },
      { status: 503 }
    );
  }

  const rows = (rowsResp.data ?? []) as Lead[];
  const timed: Lead[] = [];
  const flex: Lead[] = [];
  for (const l of rows) {
    if (l.scheduled_time) timed.push(l);
    else if (l.flex_window) flex.push(l);
  }
  timed.sort(
    (a, b) => parseHHMM(a.scheduled_time!) - parseHHMM(b.scheduled_time!)
  );

  const leadLabel = (l: Lead, fallback: string): string =>
    l.client?.trim() ||
    `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
    fallback;

  if (flex.length === 0) {
    const result: OptimizeResponse = {
      date: iso,
      placements: [],
      unplaced: [],
      timedStops: timed.map((l) => ({
        leadId: l.id,
        label: leadLabel(l, "Scheduled job"),
        startTime: l.scheduled_time!,
      })),
      addedDriveMinutes: 0,
      nothingToDo: true,
    };
    return NextResponse.json(result);
  }

  // Validate addresses upfront so we fail with a useful message rather
  // than a cryptic Distance-Matrix error.
  for (const l of [...timed, ...flex]) {
    if (!leadAddressString(l)) {
      const name = leadLabel(l, "A lead");
      return NextResponse.json(
        { error: `"${name}" has no address — add one before optimizing.` },
        { status: 400 }
      );
    }
  }

  // Build the node list: 0 = home, 1..T = timed, T+1..T+F = flex.
  const timedAddrs = timed.map((l) => leadAddressString(l)!);
  const flexAddrs = flex.map((l) => leadAddressString(l)!);
  const nodes = [home, ...timedAddrs, ...flexAddrs];

  let matrixSec: number[][];
  try {
    const flat = await getDriveMatrix(nodes, nodes);
    matrixSec = Array.from({ length: nodes.length }, (_, i) =>
      Array.from(
        { length: nodes.length },
        (_, j) => flat[i * nodes.length + j].drive_seconds
      )
    );
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // driveMin(i, j) — integer minutes, minimum 1 so pure-same-address edge
  // cases still leave room for snap rounding.
  const driveMin = (i: number, j: number): number =>
    Math.max(1, Math.round(matrixSec[i][j] / 60));

  const jobMin = settings.default_job_minutes;
  const workStart = parseHHMM(settings.work_start_time);
  const workEnd = parseHHMM(settings.work_end_time);

  /** Snap to the nearest 30-minute boundary (rounding UP) so suggested
   *  start times match the rest of the scheduling UI. */
  const snap30 = (min: number): number => Math.ceil(min / 30) * 30;

  // Current itinerary (timed stops only). Each entry captures its node
  // index so we can look up drive times. We'll insert flex stops into
  // this list one at a time via cheapest-insertion.
  type Slot =
    | { kind: "timed"; nodeIdx: number; startMin: number; endMin: number; leadId: string }
    | { kind: "flex"; nodeIdx: number; startMin: number; endMin: number; leadId: string };
  const itinerary: Slot[] = timed.map((l, i) => {
    const start = parseHHMM(l.scheduled_time!);
    return {
      kind: "timed",
      nodeIdx: 1 + i,
      startMin: start,
      endMin: start + jobMin,
      leadId: l.id,
    };
  });

  const placements: Placement[] = [];
  const unplaced: OptimizeResponse["unplaced"] = [];

  // Greedy: place flex leads one at a time. Each iteration re-evaluates
  // insertion points against the current itinerary (which grows as we
  // place leads). We don't re-order previously placed leads — keeping
  // the algorithm predictable is worth the small optimality gap.
  for (let k = 0; k < flex.length; k++) {
    const f = flex[k];
    const fNode = 1 + timed.length + k;
    const window = f.flex_window as "all_day" | "am" | "pm";

    // Candidate insertion slots: "between prev and next" where prev is
    // either home or a previously placed stop, and next is either the
    // immediately following stop or home (at end of day).
    let bestStart = -1;
    let bestPos = -1;
    let bestAdded = Infinity;

    for (let pos = 0; pos <= itinerary.length; pos++) {
      const prev = pos === 0 ? null : itinerary[pos - 1];
      const next = pos === itinerary.length ? null : itinerary[pos];
      const prevNodeIdx = prev ? prev.nodeIdx : 0;
      const nextNodeIdx = next ? next.nodeIdx : 0;
      const prevEndMin = prev ? prev.endMin : workStart;
      const nextStartMin = next ? next.startMin : workEnd;

      const driveIn = driveMin(prevNodeIdx, fNode);
      const driveOut = driveMin(fNode, nextNodeIdx);
      const driveBetween = driveMin(prevNodeIdx, nextNodeIdx);
      const added = driveIn + driveOut - driveBetween;

      const earliest = snap30(prevEndMin + driveIn);
      // We can't start before the earliest arrival, and must finish +
      // drive to next stop by its start.
      const latestFeasible = nextStartMin - driveOut - jobMin;
      if (earliest > latestFeasible) continue;

      // Window constraint: pick the earliest start that satisfies the
      // window. If AM and earliest ≥ noon, this slot is invalid for AM.
      // If PM and latestFeasible < noon, this slot is invalid for PM.
      let startCandidate = earliest;
      if (window === "pm" && startCandidate < NOON) {
        startCandidate = snap30(NOON);
        if (startCandidate > latestFeasible) continue;
      }
      if (window === "am" && startCandidate >= NOON) continue;
      // We also need the job to sit inside work hours.
      if (startCandidate + jobMin > workEnd) continue;

      if (added < bestAdded) {
        bestAdded = added;
        bestStart = startCandidate;
        bestPos = pos;
      }
    }

    if (bestPos === -1) {
      unplaced.push({
        leadId: f.id,
        label: leadLabel(f, "Flex job"),
        flexWindow: window,
        reason:
          window === "am"
            ? "No AM slot fits this address without bumping a timed stop."
            : window === "pm"
              ? "No PM slot fits this address without bumping a timed stop."
              : "No slot fits this address inside your work hours.",
      });
      continue;
    }

    const prev = bestPos === 0 ? null : itinerary[bestPos - 1];
    itinerary.splice(bestPos, 0, {
      kind: "flex",
      nodeIdx: fNode,
      startMin: bestStart,
      endMin: bestStart + jobMin,
      leadId: f.id,
    });
    placements.push({
      leadId: f.id,
      label: leadLabel(f, "Flex job"),
      startTime: formatHHMM(bestStart),
      flexWindow: window,
      insertAfter: prev ? prev.leadId : null,
      addedDriveMinutes: bestAdded,
    });
  }

  const totalAdded = placements.reduce(
    (acc, p) => acc + p.addedDriveMinutes,
    0
  );

  const result: OptimizeResponse = {
    date: iso,
    placements,
    unplaced,
    timedStops: timed.map((l) => ({
      leadId: l.id,
      label: leadLabel(l, "Scheduled job"),
      startTime: l.scheduled_time!,
    })),
    addedDriveMinutes: totalAdded,
    nothingToDo: false,
  };
  return NextResponse.json(result);
}

// ─── POST: apply placements ───────────────────────────────────────────────

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = applyBodySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();

  // Load the leads we're about to update — enforces workspace membership
  // and confirms every id is (a) on this day and (b) still a flex lead.
  // If a row has been retimed in another tab since the preview, we bail
  // rather than overwrite the new time.
  const ids = parsed.placements.map((p) => p.leadId);
  const { data: rows, error } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const leadById = new Map<string, Lead>(
    ((rows ?? []) as Lead[]).map((l) => [l.id, l])
  );
  for (const p of parsed.placements) {
    const l = leadById.get(p.leadId);
    if (!l) {
      return NextResponse.json(
        { error: `Lead ${p.leadId} not found in this workspace.` },
        { status: 404 }
      );
    }
    if (l.scheduled_day !== parsed.date) {
      return NextResponse.json(
        {
          error:
            `"${l.client ?? l.id}" is no longer on ${parsed.date}. ` +
            `Please reopen Optimize to re-compute.`,
        },
        { status: 409 }
      );
    }
    if (l.scheduled_time) {
      return NextResponse.json(
        {
          error:
            `"${l.client ?? l.id}" already has a time set. ` +
            `Please reopen Optimize to re-compute.`,
        },
        { status: 409 }
      );
    }
    if (!l.flex_window) {
      return NextResponse.json(
        {
          error:
            `"${l.client ?? l.id}" is no longer a flex lead. ` +
            `Please reopen Optimize to re-compute.`,
        },
        { status: 409 }
      );
    }
  }

  // Calendar sync is best-effort — we always write DB first so a
  // transient Google failure can't leave DB + Calendar out of sync
  // in a way that's hard to repair.
  let token: string | null = null;
  if (parsed.sync) {
    try {
      token = await getAccessToken(auth.userId);
    } catch {
      token = null;
    }
  }

  type PerLeadResult = {
    leadId: string;
    label: string;
    startTime: string;
    calendar: "off" | "skipped" | "created" | "updated" | "error";
    calendarError?: string;
  };
  const results: PerLeadResult[] = [];

  for (const p of parsed.placements) {
    const lead = leadById.get(p.leadId)!;
    const label =
      lead.client?.trim() ||
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      "Flex job";

    const { error: updErr } = await supabase
      .from("leads")
      .update({ scheduled_time: p.startTime, flex_window: null })
      .eq("id", lead.id);
    if (updErr) {
      return NextResponse.json(
        { error: `Failed to set time for "${label}": ${updErr.message}` },
        { status: 500 }
      );
    }

    const leadNext: Lead = {
      ...lead,
      scheduled_time: p.startTime,
      flex_window: null,
    };
    if (!token || !parsed.sync || !canSchedule(leadNext)) {
      results.push({
        leadId: lead.id,
        label,
        startTime: p.startTime,
        calendar: parsed.sync ? (token ? "skipped" : "off") : "skipped",
      });
      continue;
    }

    // Another request is mid-create on this lead's calendar event. Skip
    // so we don't pass the "pending:" sentinel to updateCalendarEvent.
    if (isPendingCalendarClaim(lead.calendar_event_id)) {
      results.push({
        leadId: lead.id,
        label,
        startTime: p.startTime,
        calendar: "skipped",
      });
      continue;
    }

    try {
      const realEventId = realCalendarEventId(lead.calendar_event_id);
      const event = realEventId
        ? await updateCalendarEvent(token, realEventId, leadNext)
        : await createCalendarEvent(token, leadNext);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: parsed.date,
          calendar_scheduled_time: p.startTime,
        })
        .eq("id", lead.id);
      results.push({
        leadId: lead.id,
        label,
        startTime: p.startTime,
        calendar: realEventId ? "updated" : "created",
      });
    } catch (e) {
      results.push({
        leadId: lead.id,
        label,
        startTime: p.startTime,
        calendar: "error",
        calendarError: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    date: parsed.date,
    applied: results.length,
    calendarConnected: Boolean(token),
    results,
  });
}
