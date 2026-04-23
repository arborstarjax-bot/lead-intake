import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import { suggestSlots } from "@/modules/schedule/server";
import { MapsUnavailableError } from "@/modules/routing/server";
import type { Lead } from "@/modules/leads/model";
import { todayIsoInBusinessTz } from "@/modules/shared/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    leadId: z.string().uuid(),
    half: z.enum(["morning", "afternoon", "all"]).default("all"),
    /** Optional YYYY-MM-DD override; used by the flexible-day flow. */
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
      .optional(),
    /** Zero-based page into the ranked slot list. The UI bumps this when
     *  the user clicks "Show other times" to cycle past the initial 3. */
    offset: z.number().int().min(0).max(20).default(0),
  })
  .strict();

export async function POST(req: Request) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI scheduling needs a Google Maps API key. Add GOOGLE_MAPS_API_KEY on Vercel and redeploy.",
      },
      { status: 503 }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();

  const [leadResp, settings] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("id", parsed.leadId)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle(),
    getSettings(auth.workspaceId),
  ]);

  if (leadResp.error || !leadResp.data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const lead = leadResp.data as Lead;

  // Caller can override the lead's own scheduled_day (flexible-day flow) by
  // passing `day` in the body. Fall back to whatever is on the lead itself.
  const targetDay = parsed.day ?? lead.scheduled_day;
  if (!targetDay) {
    return NextResponse.json(
      { error: "This lead needs a scheduled day before ranking slots." },
      { status: 400 }
    );
  }

  // Refuse to schedule into the past. Compare as calendar days in the
  // business timezone — using UTC would block booking between ~8 PM and
  // midnight ET because the server clock is already "tomorrow".
  const todayIso = todayIsoInBusinessTz();
  if (targetDay < todayIso) {
    return NextResponse.json(
      { error: "That day is in the past — pick a future date." },
      { status: 400 }
    );
  }

  // Only count other leads that are pinned to a specific time on the same day
  // and still on the calendar. Completed jobs are excluded intentionally — once
  // a job is done it's off Google Calendar and no longer occupies the slot, so
  // new work can be scheduled in its place without an artificial overlap.
  const { data: sameDay, error: sameDayErr } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .eq("scheduled_day", targetDay)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .neq("id", lead.id);
  if (sameDayErr) {
    return NextResponse.json({ error: sameDayErr.message }, { status: 500 });
  }

  try {
    const { slots, warnings, hasMore, totalCount } = await suggestSlots({
      lead,
      settings,
      others: (sameDay ?? []) as Lead[],
      half: parsed.half,
      offset: parsed.offset,
    });
    return NextResponse.json({ slots, warnings, hasMore, totalCount });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google Maps: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
