import { NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import { MapsUnavailableError, createDriveMemo } from "@/modules/routing/server";
import { geocodeMany, type LatLng } from "@/modules/routing/server";
import { leadAddressString, parseHHMM, formatHHMM } from "@/modules/schedule/server";
import { todayIsoInBusinessTz } from "@/modules/shared/date";
import type { Lead, LeadFlexWindow } from "@/modules/leads/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/schedule/route?date=YYYY-MM-DD
 *
 * Returns the list of scheduled jobs for the given day along with each
 * stop's lat/lng (for rendering pins) and drive minutes from the previous
 * stop (for annotating the list view). Also returns the home lat/lng so the
 * client can render a Home pin and a dashed line to the first stop.
 *
 * Used by /route. Separate from /today because (a) it takes an arbitrary
 * day parameter, and (b) it geocodes — which the today card doesn't need.
 */

type MapStop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  driveMinutesFromPrev: number | null;
  /** Road-distance from the previous stop in miles. Null when Distance
   *  Matrix didn't return a value (API error, unroutable, no home). */
  distanceMilesFromPrev: number | null;
  /** Carried through so the timeline menu can surface a "Text confirmation"
   *  action without a second round-trip per lead. */
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
  /** Row's `updated_at` at fetch time. The client includes it as
   *  `expected_updated_at` on follow-up PATCHes so the server can reject
   *  concurrent writes with 409 instead of silently overwriting. */
  updatedAt: string | null;
  /** True when the estimate has been completed (Sold, Not Sold, or Pending). */
  done: boolean;
  /** Outcome label for completed estimates (e.g. "Sold", "Not Sold", "Pending"). */
  outcomeLabel: string | null;
};

/**
 * Flex-window leads for the day. They share a scheduled_day with timed
 * stops but intentionally have no scheduled_time (the route optimizer
 * will assign one later). Returned as a separate list so the estimates
 * UI can render them below the timed stops with a "Flex — …" label in
 * place of a start time, and so the map can render them as un-numbered
 * pins without participating in drive-leg computation.
 */
type FlexStop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  flexWindow: LeadFlexWindow;
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
  /** See MapStop.updatedAt. */
  updatedAt: string | null;
  /** True when the estimate has been completed (Sold, Not Sold, or Pending). */
  done: boolean;
  /** Outcome label for completed estimates. */
  outcomeLabel: string | null;
};

type GhostStop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  /** Lead's own scheduled_day — hint so the scheduler panel can default the
   *  day picker to what the customer asked for. */
  desiredDay: string | null;
  /** Current scheduled_time, if any — so rescheduling pre-selects a half. */
  currentTime: string | null;
  /** See MapStop.updatedAt. Lets the SchedulePanel include the guard on
   *  the PATCH it fires when the user confirms a slot. */
  updatedAt: string | null;
};

type RouteResponse = {
  date: string;
  home: (LatLng & { address: string }) | null;
  stops: MapStop[];
  flexStops: FlexStop[];
  /** Stops that couldn't be geocoded — surfaced so the UI can warn. */
  unresolved: { id: string; label: string; address: string }[];
  totalDriveMinutes: number | null;
  returnDriveMinutes: number | null;
  /** Prospective lead being scheduled (if ?ghost=<leadId> was passed). */
  ghost: GhostStop | null;
  /** If the ghost lead's address couldn't be geocoded, surface a reason. */
  ghostError: string | null;
};

function validDate(d: string | null, tz: string): string {
  const fallback = todayIsoInBusinessTz(tz);
  if (!d) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback;
}

export async function GET(req: Request) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const ghostLeadId = url.searchParams.get("ghost");

  const supabase = createAdminClient();
  const settings = await getSettings(auth.workspaceId);
  const iso = validDate(url.searchParams.get("date"), settings.timezone);
  // Fetch leads + tasks for the day + optional ghost lead in parallel.
  // Tasks are treated like timed stops alongside estimates.
  const dayStart = `${iso}T00:00:00`;
  const dayEnd = `${iso}T23:59:59`;
  const [rowsResp, tasksResp, ghostResp] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("scheduled_day", iso)
      .order("scheduled_time", { ascending: true, nullsFirst: false }),
    supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .neq("status", "Cancelled")
      .gte("start_at", dayStart)
      .lte("start_at", dayEnd)
      .order("start_at", { ascending: true }),
    ghostLeadId
      ? supabase
          .from("leads")
          .select("*")
          .eq("id", ghostLeadId)
          .eq("workspace_id", auth.workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (rowsResp.error) {
    return NextResponse.json({ error: rowsResp.error.message }, { status: 500 });
  }
  const dayTasks = (tasksResp.data ?? []) as Array<Record<string, unknown>>;
  // Exclude the ghost lead from the rendered day so its existing (stale)
  // pin doesn't overlap with the amber ghost preview during a reschedule.
  const leads = ((rowsResp.data ?? []) as Lead[]).filter(
    (l) => !ghostLeadId || l.id !== ghostLeadId
  );
  const ghostLead = (ghostResp?.data ?? null) as Lead | null;

  // Partition into timed stops (have a scheduled_time — participate in
  // drive legs + sit in the numbered sequence) vs flex stops (flex
  // window only — grouped separately, no leg math, no sequence).
  const leadLabel = (l: Lead, fallback: string): string =>
    l.client?.trim() ||
    `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
    fallback;

  const DONE_STATUSES = new Set(["Completed", "Pending", "Lost", "Sold"]);
  function isLeadDone(l: Lead): boolean {
    return DONE_STATUSES.has(l.status ?? "");
  }
  function leadOutcomeLabel(l: Lead): string | null {
    if (l.status === "Pending") return "Pending";
    if (l.estimate_outcome === "Sold") return "Sold";
    if (l.estimate_outcome === "Not Sold") return "Not Sold";
    if (l.status === "Lost") return "Lost";
    if (l.status === "Completed") return "Completed";
    return null;
  }

  const leadStopsInput = leads
    .map((l) => {
      const addr = leadAddressString(l);
      const time = l.scheduled_time;
      if (!addr || !time) return null;
      const startMin = parseHHMM(time);
      return {
        id: l.id,
        label: leadLabel(l, "Scheduled job"),
        address: addr,
        startMin,
        endMin: startMin + settings.default_job_minutes,
        firstName: l.first_name ?? null,
        phoneNumber: l.phone_number ?? null,
        salesPerson: l.sales_person ?? null,
        updatedAt: l.updated_at ?? null,
        done: isLeadDone(l),
        outcomeLabel: leadOutcomeLabel(l),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Convert tasks into the same stop format as leads
  const taskStopsInput = dayTasks
    .map((t) => {
      const addr =
        [t.address, t.city, t.state, t.zip].filter(Boolean).join(", ") || null;
      if (!addr) return null;
      const start = new Date(t.start_at as string);
      const end = new Date(t.end_at as string);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = end.getHours() * 60 + end.getMinutes();
      return {
        id: `task-${t.id as string}`,
        label: `${(t.name as string) || "Task"}`,
        address: addr,
        startMin,
        endMin: Math.max(endMin, startMin + 30),
        firstName: null as string | null,
        phoneNumber: null as string | null,
        salesPerson: (t.assignee as string) ?? null,
        updatedAt: (t.updated_at as string) ?? null,
        done: t.status === "Completed",
        outcomeLabel: t.status === "Completed" ? "Completed" : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const stopsInput = [...leadStopsInput, ...taskStopsInput]
    .sort((a, b) => a.startMin - b.startMin);

  const flexInput = leads
    .map((l) => {
      if (l.scheduled_time || !l.flex_window) return null;
      const addr = leadAddressString(l);
      if (!addr) return null;
      return {
        id: l.id,
        label: leadLabel(l, "Flex job"),
        address: addr,
        flexWindow: l.flex_window,
        firstName: l.first_name ?? null,
        phoneNumber: l.phone_number ?? null,
        salesPerson: l.sales_person ?? null,
        updatedAt: l.updated_at ?? null,
        done: isLeadDone(l),
        outcomeLabel: leadOutcomeLabel(l),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const home = homeAddressString(settings);
  const hasMapsKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);

  if (!hasMapsKey) {
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY is not set." }, { status: 503 });
  }

  // Resolve the ghost lead's address up-front so it joins the same geocoding
  // batch as the rest of the day — one round-trip to Google either way, and
  // the result sits in the same cache table.
  const ghostAddr = ghostLead ? leadAddressString(ghostLead) : null;

  // Geocode the home (if set) + every stop + the ghost address in parallel.
  // Cache-hit paths are instant; misses go out to Google.
  const geocodeInputs = [
    ...(home ? [home] : []),
    ...stopsInput.map((s) => s.address),
    ...flexInput.map((s) => s.address),
    ...(ghostAddr ? [ghostAddr] : []),
  ];
  let geocodes: Map<string, LatLng | null>;
  try {
    geocodes = await geocodeMany(geocodeInputs);
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json({ error: `Google: ${e.message}`, code: e.code }, { status: 502 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const resolvedStops: MapStop[] = [];
  const resolvedFlexStops: FlexStop[] = [];
  const unresolved: RouteResponse["unresolved"] = [];
  for (const s of stopsInput) {
    const g = geocodes.get(s.address);
    if (!g) {
      unresolved.push({ id: s.id, label: s.label, address: s.address });
      continue;
    }
    resolvedStops.push({
      id: s.id,
      label: s.label,
      address: s.address,
      lat: g.lat,
      lng: g.lng,
      startTime: formatHHMM(s.startMin),
      endTime: formatHHMM(s.endMin),
      driveMinutesFromPrev: null,
      distanceMilesFromPrev: null,
      firstName: s.firstName,
      phoneNumber: s.phoneNumber,
      salesPerson: s.salesPerson,
      updatedAt: s.updatedAt,
      done: s.done,
      outcomeLabel: s.outcomeLabel,
    });
  }
  for (const f of flexInput) {
    const g = geocodes.get(f.address);
    if (!g) {
      unresolved.push({ id: f.id, label: f.label, address: f.address });
      continue;
    }
    resolvedFlexStops.push({
      id: f.id,
      label: f.label,
      address: f.address,
      lat: g.lat,
      lng: g.lng,
      flexWindow: f.flexWindow,
      firstName: f.firstName,
      phoneNumber: f.phoneNumber,
      salesPerson: f.salesPerson,
      updatedAt: f.updatedAt,
      done: f.done,
      outcomeLabel: f.outcomeLabel,
    });
  }

  const homeLatLng = home ? geocodes.get(home) ?? null : null;

  // Compute drive legs for the list view (home → stop1 → … → home). Only
  // possible when we have a home AND at least one resolved stop. One Google
  // Distance Matrix call per leg via the shared memo.
  let totalDriveMinutes: number | null = null;
  let returnDriveMinutes: number | null = null;
  if (homeLatLng && home && resolvedStops.length > 0) {
    const drive = createDriveMemo();
    try {
      for (let i = 0; i < resolvedStops.length; i++) {
        const from = i === 0 ? home : resolvedStops[i - 1].address;
        const leg = await drive(from, resolvedStops[i].address);
        resolvedStops[i].driveMinutesFromPrev = Math.round(leg.drive_seconds / 60);
        resolvedStops[i].distanceMilesFromPrev =
          Math.round((leg.distance_meters / 1609.344) * 10) / 10;
      }
      const ret = await drive(resolvedStops[resolvedStops.length - 1].address, home);
      returnDriveMinutes = Math.round(ret.drive_seconds / 60);
      totalDriveMinutes =
        resolvedStops.reduce((a, s) => a + (s.driveMinutesFromPrev ?? 0), 0) +
        (returnDriveMinutes ?? 0);
    } catch {
      // Leave drive annotations blank on Distance Matrix failure; pins still
      // render. The user can still see the schedule.
    }
  }

  // Build the ghost payload. Any failure path (no lead, no address, geocode
  // miss) collapses to ghost=null + a human-readable ghostError so the
  // scheduler panel can explain why no preview pin appears.
  let ghost: GhostStop | null = null;
  let ghostError: string | null = null;
  if (ghostLeadId) {
    if (!ghostLead) {
      ghostError = "Lead not found.";
    } else if (!ghostAddr) {
      ghostError = "This lead has no address yet — add one to preview on the map.";
    } else {
      const g = geocodes.get(ghostAddr);
      if (!g) {
        ghostError = "Google couldn't geocode this lead's address.";
      } else {
        ghost = {
          id: ghostLead.id,
          label:
            ghostLead.client?.trim() ||
            `${ghostLead.first_name ?? ""} ${ghostLead.last_name ?? ""}`.trim() ||
            "Prospective job",
          address: ghostAddr,
          lat: g.lat,
          lng: g.lng,
          desiredDay: ghostLead.scheduled_day ?? null,
          currentTime: ghostLead.scheduled_time ?? null,
          updatedAt: ghostLead.updated_at ?? null,
        };
      }
    }
  }

  const body: RouteResponse = {
    date: iso,
    home: homeLatLng && home ? { ...homeLatLng, address: home } : null,
    stops: resolvedStops,
    flexStops: resolvedFlexStops,
    unresolved,
    totalDriveMinutes,
    returnDriveMinutes,
    ghost,
    ghostError,
  };
  return NextResponse.json(body);
}
