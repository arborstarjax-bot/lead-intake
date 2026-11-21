import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import { applySettingsPatch, settingsPatchSchema } from "@/modules/settings/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const settings = await getSettings(auth.workspaceId);
  return NextResponse.json({ settings, role: auth.role });
}

export async function PUT(req: Request) {
  // Any workspace member can update lead_sources; all other fields require admin.
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    parsed = settingsPatchSchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { status, body } = await applySettingsPatch(auth.workspaceId, auth.role, parsed);
  return NextResponse.json(body, { status });
}
