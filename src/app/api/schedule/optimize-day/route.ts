import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { requireMembership } from "@/lib/auth";
import { MapsUnavailableError, getDriveMatrix } from "@/lib/maps";
import { leadAddressString, parseHHMM } from "@/lib/schedule";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/schedule/optimize-day?date=YYYY-MM-DD
 *
 * Propose the minimum-drive-time visit order for a day's stops using the
 * home address as both start and end point. Returns both the current order
 * (what is booked today) and the optimal order so the UI can show a
 * side-by-side preview. Does NOT mutate — the client posts the optimal
 * order to /api/schedule/reorder to apply.
 *
 * Algorithm:
 *  - n = number of stops. Pull one Distance Matrix for the full
 *    (home + stops) x (home + stops) grid — one HTTP call.
 *  - n ≤ 9 → brute-force all permutations of the middle stops with
 *    home fixed at both ends (cost = 9! = 362,880 comparisons, ~40ms).
 *  - n ≥ 10 → nearest-neighbor seed then 2-opt until no improving swap.
 *    Not optimal in theory but typically within 2% of optimal on routing
 *    problems of this scale; a third-party MIP solver is overkill.
 */

type OptimizeResponse = {
  date: string;
  /** Lead IDs in the currently-booked order. */
  currentOrder: string[];
  /** Lead IDs in the recommended optimal order. */
  optimalOrder: string[];
  /** Total driving minutes for the current order including return leg. */
  currentDriveMinutes: number;
  /** Total driving minutes for the optimal order including return leg. */
  optimalDriveMinutes: number;
  /** currentDriveMinutes - optimalDriveMinutes, floored at 0. */
  savingsMinutes: number;
  /** Client label per lead so the preview can name each row. */
  labels: Record<string, string>;
  /** True when the optimal order is identical to the current order. */
  alreadyOptimal: boolean;
};

function validDate(d: string | null): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function GET(req: Request) {
  const iso = validDate(new URL(req.url).searchParams.get("date"));
  if (!iso) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const [settings, rowsResp] = await Promise.all([
    getSettings(auth.workspaceId),
    supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("scheduled_day", iso)
      .not("scheduled_time", "is", null)
      .neq("status", "Completed")
      .order("scheduled_time", { ascending: true }),
  ]);
  if (rowsResp.error) {
    return NextResponse.json({ error: rowsResp.error.message }, { status: 500 });
  }
  const home = homeAddressString(settings);
  if (!home) {
    return NextResponse.json(
      { error: "Set your starting address in Settings before optimizing." },
      { status: 400 }
    );
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY is not set." },
      { status: 503 }
    );
  }

  const leads = (rowsResp.data ?? []) as Lead[];
  if (leads.length < 2) {
    return NextResponse.json(
      {
        error:
          "Need at least 2 stops on this day before optimization has anything to do.",
      },
      { status: 400 }
    );
  }

  // Sort by booked start time so the "current order" reflects what the user
  // actually sees in Timeline, not DB insertion order.
  const ordered = leads
    .slice()
    .sort(
      (a, b) =>
        parseHHMM(a.scheduled_time ?? "00:00") -
        parseHHMM(b.scheduled_time ?? "00:00")
    );

  // Require every stop to have an address — without that we can't price a leg.
  const addresses: string[] = [];
  const labels: Record<string, string> = {};
  for (const l of ordered) {
    const addr = leadAddressString(l);
    const name =
      l.client?.trim() ||
      `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
      "Scheduled job";
    labels[l.id] = name;
    if (!addr) {
      return NextResponse.json(
        { error: `"${name}" has no address — add one before optimizing.` },
        { status: 400 }
      );
    }
    addresses.push(addr);
  }

  // Full (home + stops) x (home + stops) matrix in a single Distance Matrix
  // call. The API returns results in row-major order; `idx(i, j)` picks the
  // duration from node i to node j. Node 0 = home, nodes 1..n = stops.
  const n = ordered.length;
  const nodes = [home, ...addresses];
  let matrix: number[][];
  try {
    const flat = await getDriveMatrix(nodes, nodes);
    matrix = Array.from({ length: nodes.length }, (_, i) =>
      Array.from(
        { length: nodes.length },
        (_, j) => flat[i * nodes.length + j].drive_seconds
      )
    );
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Tour cost: home → perm[0] → perm[1] → … → perm[n-1] → home.
  // perm holds stop indices (1..n) — home (0) is fixed at both ends.
  function tourCost(perm: number[]): number {
    let total = matrix[0][perm[0]];
    for (let i = 0; i < perm.length - 1; i++) {
      total += matrix[perm[i]][perm[i + 1]];
    }
    total += matrix[perm[perm.length - 1]][0];
    return total;
  }

  const currentPerm = ordered.map((_, i) => i + 1);
  const currentCost = tourCost(currentPerm);

  let optimalPerm: number[];
  if (n <= 9) {
    optimalPerm = bruteForceOptimal(currentPerm, tourCost);
  } else {
    optimalPerm = twoOptOptimal(currentPerm, tourCost, matrix);
  }
  const optimalCost = tourCost(optimalPerm);

  const currentDriveMinutes = Math.round(currentCost / 60);
  const optimalDriveMinutes = Math.round(optimalCost / 60);
  const savingsMinutes = Math.max(0, currentDriveMinutes - optimalDriveMinutes);
  const alreadyOptimal = currentPerm.every((v, i) => v === optimalPerm[i]);

  const result: OptimizeResponse = {
    date: iso,
    currentOrder: currentPerm.map((idx) => ordered[idx - 1].id),
    optimalOrder: optimalPerm.map((idx) => ordered[idx - 1].id),
    currentDriveMinutes,
    optimalDriveMinutes,
    savingsMinutes,
    labels,
    alreadyOptimal,
  };
  return NextResponse.json(result);
}

/** Heap's algorithm permutation walk — finds the minimum-cost tour. */
function bruteForceOptimal(
  seed: number[],
  cost: (p: number[]) => number
): number[] {
  const perm = seed.slice();
  let bestPerm = perm.slice();
  let bestCost = cost(perm);
  const n = perm.length;
  const c = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swap = i % 2 === 0 ? 0 : c[i];
      [perm[swap], perm[i]] = [perm[i], perm[swap]];
      const candidate = cost(perm);
      if (candidate < bestCost) {
        bestCost = candidate;
        bestPerm = perm.slice();
      }
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
  return bestPerm;
}

/** Nearest-neighbor seed, then 2-opt until no improving swap. Good enough
 * for n ≥ 10 where brute force is too slow. */
function twoOptOptimal(
  seed: number[],
  cost: (p: number[]) => number,
  matrix: number[][]
): number[] {
  // Nearest neighbor starting from home (index 0).
  const unvisited = new Set(seed);
  const nn: number[] = [];
  let last = 0;
  while (unvisited.size > 0) {
    let bestNext = -1;
    let bestDist = Infinity;
    for (const candidate of unvisited) {
      const d = matrix[last][candidate];
      if (d < bestDist) {
        bestDist = d;
        bestNext = candidate;
      }
    }
    nn.push(bestNext);
    unvisited.delete(bestNext);
    last = bestNext;
  }

  let current = nn;
  let currentCost = cost(current);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = current.slice();
        const slice = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, slice.length, ...slice);
        const candidateCost = cost(candidate);
        if (candidateCost < currentCost) {
          current = candidate;
          currentCost = candidateCost;
          improved = true;
        }
      }
    }
  }
  return current;
}
