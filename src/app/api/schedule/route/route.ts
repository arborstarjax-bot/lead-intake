import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { MapsUnavailableError, createDriveMemo } from "@/lib/maps";
import { geocodeMany, type LatLng } from "@/lib/geocode";
import { leadAddressString, parseHHMM, formatHHMM } from "@/lib/schedule";
import { todayIsoInBusinessTz } from "@/lib/date";
import type { Lead } from "@/lib/types";

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
  /** Carried through so the timeline menu can surface a "Text confirmation"
   *  action without a second round-trip per lead. */
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
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
};

type RouteResponse = {
  date: string;
  home: (LatLng & { address: string }) | null;
  stops: MapStop[];
  /** Stops that couldn't be geocoded — surfaced so the UI can warn. */
  unresolved: { id: string; label: string; address: string }[];
  totalDriveMinutes: number | null;
  returnDriveMinutes: number | null;
  /** Prospective lead being scheduled (if ?ghost=<leadId> was passed). */
  ghost: GhostStop | null;
  /** If the ghost lead's address couldn't be geocoded, surface a reason. */
  ghostError: string | null;
};

function validDate(d: string | null): string {
  const fallback = todayIsoInBusinessTz();
  if (!d) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const iso = validDate(url.searchParams.get("date"));
  const ghostLeadId = url.searchParams.get("ghost");

  const supabase = createAdminClient();
  const [settings, rowsResp, ghostResp] = await Promise.all([
    getSettings(),
    supabase
      .from("leads")
      .select("*")
      .eq("scheduled_day", iso)
      .not("scheduled_time", "is", null)
      .neq("status", "Completed")
      .order("scheduled_time", { ascending: true }),
    ghostLeadId
      ? supabase.from("leads").select("*").eq("id", ghostLeadId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (rowsResp.error) {
    return NextResponse.json({ error: rowsResp.error.message }, { status: 500 });
  }
  // Exclude the ghost lead from the rendered day so its existing (stale)
  // pin doesn't overlap with the amber ghost preview during a reschedule.
  const leads = ((rowsResp.data ?? []) as Lead[]).filter(
    (l) => !ghostLeadId || l.id !== ghostLeadId
  );
  const ghostLead = (ghostResp?.data ?? null) as Lead | null;

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
        endMin: startMin + settings.default_job_minutes,
        firstName: l.first_name ?? null,
        phoneNumber: l.phone_number ?? null,
        salesPerson: l.sales_person ?? null,
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
      firstName: s.firstName,
      phoneNumber: s.phoneNumber,
      salesPerson: s.salesPerson,
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
        };
      }
    }
  }

  const body: RouteResponse = {
    date: iso,
    home: homeLatLng && home ? { ...homeLatLng, address: home } : null,
    stops: resolvedStops,
    unresolved,
    totalDriveMinutes,
    returnDriveMinutes,
    ghost,
    ghostError,
  };
  return NextResponse.json(body);
}
