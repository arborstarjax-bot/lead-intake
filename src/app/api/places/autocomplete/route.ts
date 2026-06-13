import { NextRequest, NextResponse } from "next/server";
import { getSessionMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

const GOOGLE_API = "https://maps.googleapis.com/maps/api/place/autocomplete/json";

export async function GET(req: NextRequest) {
  const auth = await getSessionMembership();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const input = req.nextUrl.searchParams.get("input");
  if (!input?.trim()) return NextResponse.json({ predictions: [] });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 }
    );
  }

  const url = new URL(GOOGLE_API);
  url.searchParams.set("input", input);
  url.searchParams.set("types", "address");
  url.searchParams.set("components", "country:us");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const data = await res.json();

  const predictions = (data.predictions ?? []).slice(0, 5).map(
    (p: {
      place_id: string;
      description: string;
      structured_formatting?: {
        main_text?: string;
        secondary_text?: string;
      };
    }) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    })
  );

  return NextResponse.json({ predictions });
}
