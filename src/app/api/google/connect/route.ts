import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/google/oauth";
import { requireMembership } from "@/modules/auth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const state = randomBytes(16).toString("hex");
  const url = googleAuthUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
