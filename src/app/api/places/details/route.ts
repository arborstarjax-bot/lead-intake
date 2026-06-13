import { NextRequest, NextResponse } from "next/server";
import { getSessionMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

const GOOGLE_API = "https://maps.googleapis.com/maps/api/place/details/json";

export async function GET(req: NextRequest) {
  const auth = await getSessionMembership();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const placeId = req.nextUrl.searchParams.get("place_id");
  if (!placeId) {
    return NextResponse.json({ error: "place_id required" }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured" },
      { status: 503 }
    );
  }

  const url = new URL(GOOGLE_API);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "address_components,formatted_address");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.result?.address_components) {
    return NextResponse.json({ parts: null });
  }

  const comps: { long_name: string; short_name: string; types: string[] }[] =
    data.result.address_components;
  const get = (type: string) =>
    comps.find((c) => c.types.includes(type))?.long_name ?? "";
  const getShort = (type: string) =>
    comps.find((c) => c.types.includes(type))?.short_name ?? "";

  return NextResponse.json({
    parts: {
      street: `${get("street_number")} ${get("route")}`.trim(),
      city: get("locality") || get("sublocality") || get("administrative_area_level_2"),
      state: getShort("administrative_area_level_1"),
      zip: get("postal_code"),
    },
  });
}
