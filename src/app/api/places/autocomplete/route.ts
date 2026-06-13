import { NextRequest, NextResponse } from "next/server";
import { getSessionMembership } from "@/modules/auth/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { geocode } from "@/modules/routing/server";

export const runtime = "nodejs";

const GOOGLE_API = "https://maps.googleapis.com/maps/api/place/autocomplete/json";

/** 50-mile radius for location bias (in meters). */
const BIAS_RADIUS = 80_467;

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

  // Bias predictions toward the workspace's home location
  const latLng = await getWorkspaceLatLng(auth.workspaceId);
  if (latLng) {
    url.searchParams.set("location", `${latLng.lat},${latLng.lng}`);
    url.searchParams.set("radius", String(BIAS_RADIUS));
  }

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

/** Resolve the workspace's home address to lat/lng for autocomplete bias. */
async function getWorkspaceLatLng(workspaceId: string) {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("app_settings")
      .select("home_address, home_city, home_state, home_zip")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data?.home_address) return null;

    const addr = [data.home_address, data.home_city, data.home_state, data.home_zip]
      .filter(Boolean)
      .join(", ");

    return geocode(addr);
  } catch {
    // Don't let bias lookup failures break autocomplete
    return null;
  }
}
