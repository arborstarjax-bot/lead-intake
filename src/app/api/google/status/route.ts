import { NextResponse } from "next/server";
import { isGoogleConnected } from "@/lib/google/oauth";
import { requireMembership } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const connected = await isGoogleConnected(auth.userId);
  return NextResponse.json({ connected });
}
