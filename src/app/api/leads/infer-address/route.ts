import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server";
import { inferAddress, MapsUnavailableError } from "@/modules/routing/server";
import {
  normalizeState,
  normalizeZip,
} from "@/modules/shared/format";

export const runtime = "nodejs";

/**
 * POST /api/leads/infer-address
 *
 * Address intelligence endpoint: takes whatever partial address fields
 * the user has entered on a lead (street, city, state, zip) and returns
 * a normalized complete address + per-field confidence. The UI uses
 * this to auto-fill blank fields (e.g. the user typed address + city,
 * we fill state + zip) and surfaces the confidence % so the operator
 * knows how much to trust the suggestion.
 *
 * We intentionally don't mutate the lead row from this route — the
 * client decides which fields to keep (merging blanks only) and then
 * issues a normal PATCH /api/leads/[id]. That keeps the existing
 * optimistic-concurrency and lifecycle rules in one place.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const address = stringOrNull(body.address);
  const city = stringOrNull(body.city);
  const state = stringOrNull(body.state);
  const zip = stringOrNull(body.zip);

  if (!address && !city && !state && !zip) {
    return NextResponse.json(
      { error: "Provide at least one of: address, city, state, zip." },
      { status: 400 }
    );
  }

  try {
    const inferred = await inferAddress({ address, city, state, zip });
    if (!inferred) {
      return NextResponse.json(
        {
          match: null,
          reason:
            "Not enough detail to resolve a specific address. Try adding a street address or zip code.",
        },
        { status: 200 }
      );
    }

    // Apply the same normalizers the PATCH endpoint uses so the returned
    // values match exactly what the lead would store — avoids the UI
    // flashing "FL" → "FL" when it's already FL, and prevents weird zip
    // variants like "32205-1234" when upstream only has 5-digit zips.
    const parts = {
      address: inferred.parts.address,
      city: inferred.parts.city,
      state: inferred.parts.state
        ? normalizeState(inferred.parts.state) ?? inferred.parts.state
        : null,
      zip: inferred.parts.zip
        ? normalizeZip(inferred.parts.zip) ?? inferred.parts.zip
        : null,
    };

    return NextResponse.json({
      match: {
        parts,
        formatted: inferred.formatted,
        confidence: inferred.confidence,
        locationType: inferred.locationType,
        partialMatch: inferred.partialMatch,
      },
    });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Address lookup unavailable (${e.code ?? "UNKNOWN"}).` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || "Address lookup failed." },
      { status: 500 }
    );
  }
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}
