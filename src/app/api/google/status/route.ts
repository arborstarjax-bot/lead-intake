import { NextResponse } from "next/server";
import { isGoogleConnected } from "@/modules/calendar/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const connected = await isGoogleConnected(auth.userId);
  return NextResponse.json({ connected });
}
