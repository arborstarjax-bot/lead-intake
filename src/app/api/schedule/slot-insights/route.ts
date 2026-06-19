import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slotSchema = z.object({
  startTime: z.string(),
  driveMinutesBefore: z.number(),
  driveMinutesAfter: z.number(),
  totalDriveMinutes: z.number(),
  priorLabel: z.string().nullable(),
  nextLabel: z.string().nullable(),
});

const bodySchema = z
  .object({
    slots: z.array(slotSchema).min(1).max(10),
    existingStopCount: z.number().int().min(0),
    totalDayDriveMinutes: z.number().nullable(),
    clusterBonusMinutes: z.number().default(0),
  })
  .strict();

const SYSTEM_PROMPT = `You are a scheduling assistant for a field service company (arborists). Given time slots for a new estimate, write a SHORT one-liner (max 60 chars) for each slot explaining its main pro or con from a route-efficiency perspective. Be specific with numbers. Use plain language a busy field worker would appreciate.

Examples of good one-liners:
- "Best fit — 8 min from your 9 AM job"
- "Clusters with 2 nearby jobs, saves driving"
- "Only AM option — 22 min detour"
- "First of day, short drive from home"
- "Tight squeeze between 10 AM and 12 PM"
- "Last slot — adds 15 min to your day"

Return a JSON array of strings, one per slot, in the same order.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const slotDescriptions = parsed.slots.map((s, i) => {
    const parts = [
      `Slot ${i + 1}: ${s.startTime}`,
      `drive before: ${s.driveMinutesBefore}m`,
      `drive after: ${s.driveMinutesAfter}m`,
      `total added drive: ${s.totalDriveMinutes}m`,
    ];
    if (s.priorLabel) parts.push(`prior: ${s.priorLabel}`);
    if (s.nextLabel) parts.push(`next: ${s.nextLabel}`);
    return parts.join(", ");
  });

  const userPrompt = [
    `Day has ${parsed.existingStopCount} existing stop${parsed.existingStopCount !== 1 ? "s" : ""}.`,
    parsed.totalDayDriveMinutes != null
      ? `Current total day drive: ${parsed.totalDayDriveMinutes}m.`
      : "",
    parsed.clusterBonusMinutes > 0
      ? `This lead clusters with nearby jobs (${parsed.clusterBonusMinutes}m bonus).`
      : "",
    "",
    "Slots to evaluate:",
    ...slotDescriptions,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15_000,
      maxRetries: 1,
    });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ insights: [] });
    }

    const result = JSON.parse(raw);
    // Accept either { insights: [...] } or a bare array
    const insights: string[] = Array.isArray(result)
      ? result
      : Array.isArray(result.insights)
        ? result.insights
        : [];

    return NextResponse.json({ insights });
  } catch (e) {
    // Non-fatal — the UI just won't show insights
    console.error("slot-insights error:", e);
    return NextResponse.json({ insights: [] });
  }
}
