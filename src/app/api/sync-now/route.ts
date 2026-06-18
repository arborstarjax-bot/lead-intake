import { NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server/session";
import { triggerCalendarSync } from "@/lib/singleops-sync";

export const runtime = "nodejs";

/**
 * POST /api/sync-now
 * Trigger an immediate calendar sync via ArborBridge.
 */
export async function POST() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const result = await triggerCalendarSync();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    entriesFound: result.entriesFound,
    changesDetected: result.changesDetected,
    syncedToLeadFlow: result.syncedToLeadFlow,
  });
}
