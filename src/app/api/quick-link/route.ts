import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Returns the quick-upload token so the admin home page can render a
 * bookmarkable URL. Since this app has no login, this endpoint is as
 * protected as the home page itself — i.e. whoever can reach the home
 * page can also see the link.
 */
export async function GET() {
  const token = process.env.LEAD_INTAKE_UPLOAD_TOKEN ?? null;
  return NextResponse.json({ token });
}
