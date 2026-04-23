import { NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import { MapsUnavailableError, createDriveMemo } from "@/modules/routing/server";
import type { Lead } from "@/modules/leads/model";
import { leadAddressString, parseHHMM, formatHHMM } from "@/modules/schedule/server";
import { todayIsoInBusinessTz } from "@/modules/shared/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteStop = {
  id: string;
  label: string;
  address: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  driveMinutesFromPrev: number | null; // null if first stop has no known home address
};

type TodayRouteResponse =
  | { hasHome: true; date: string; stops: RouteStop[]; totalDriveMinutes: number; returnDriveMinutes: number | null }
  | { hasHome: false; date: string; stops: RouteStop[]; totalDriveMinutes: 0; returnDriveMinutes: null };

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  // Pin to America/New_York so the route always reflects the workspace's
  // business day. Vercel runs UTC; without this, between ~8 PM and
  // midnight ET we'd query tomorrow's leads and show an empty route.
  const iso = todayIsoInBusinessTz();

  const [settings, rowsResp] = await Promise.all([
    getSettings(auth.workspaceId),
    supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("scheduled_day", iso)
      .not("scheduled_time", "is", null)
      .neq("status", "Completed")
      .order("scheduled_time", { ascending: true }),
  ]);

  if (rowsResp.error) {
    return NextResponse.json({ error: rowsResp.error.message }, { status: 500 });
  }
  const leads = (rowsResp.data ?? []) as Lead[];

  // Only count leads we can actually drive to.
  const stopsInput = leads
    .map((l) => {
      const addr = leadAddressString(l);
      const time = l.scheduled_time;
      if (!addr || !time) return null;
      const startMin = parseHHMM(time);
      const endMin = startMin + settings.default_job_minutes;
      return {
        id: l.id,
        label:
          l.client?.trim() ||
          `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
          "Scheduled job",
        address: addr,
        startMin,
        endMin,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const home = homeAddressString(settings);
  const hasMapsKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);

  // If there's no home address OR no maps key OR no stops, short-circuit with
  // the minimal shape — the UI can still list stops without drive annotations.
  if (!home || !hasMapsKey || stopsInput.length === 0) {
    const stops: RouteStop[] = stopsInput.map((s) => ({
      id: s.id,
      label: s.label,
      address: s.address,
      startTime: formatHHMM(s.startMin),
      endTime: formatHHMM(s.endMin),
      driveMinutesFromPrev: null,
    }));
    const body: TodayRouteResponse = {
      hasHome: false,
      date: iso,
      stops,
      totalDriveMinutes: 0,
      returnDriveMinutes: null,
    };
    return NextResponse.json(body);
  }

  // Walk the timeline home → stop1 → stop2 → … → homeReturn and price each
  // leg via a shared memo. Duplicate pairs (rare — e.g. if two back-to-back
  // jobs were at the same address) will collapse to one call.
  const drive = createDriveMemo();
  try {
    const legs: number[] = [];
    for (let i = 0; i < stopsInput.length; i++) {
      const from = i === 0 ? home : stopsInput[i - 1].address;
      const to = stopsInput[i].address;
      const res = await drive(from, to);
      legs.push(Math.round(res.drive_seconds / 60));
    }
    const returnLeg = await drive(
      stopsInput[stopsInput.length - 1].address,
      home
    );
    const returnMinutes = Math.round(returnLeg.drive_seconds / 60);

    const stops: RouteStop[] = stopsInput.map((s, i) => ({
      id: s.id,
      label: s.label,
      address: s.address,
      startTime: formatHHMM(s.startMin),
      endTime: formatHHMM(s.endMin),
      driveMinutesFromPrev: legs[i],
    }));

    const total = legs.reduce((a, b) => a + b, 0) + returnMinutes;

    const body: TodayRouteResponse = {
      hasHome: true,
      date: iso,
      stops,
      totalDriveMinutes: total,
      returnDriveMinutes: returnMinutes,
    };
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      // Fall back to the bare timeline; don't fail the dashboard just because
      // Google is down.
      const stops: RouteStop[] = stopsInput.map((s) => ({
        id: s.id,
        label: s.label,
        address: s.address,
        startTime: formatHHMM(s.startMin),
        endTime: formatHHMM(s.endMin),
        driveMinutesFromPrev: null,
      }));
      const body: TodayRouteResponse = {
        hasHome: false,
        date: iso,
        stops,
        totalDriveMinutes: 0,
        returnDriveMinutes: null,
      };
      return NextResponse.json(body);
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
