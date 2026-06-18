import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { extractTaskFromImage } from "@/modules/tasks/server";
import { normalizeState, normalizeZip } from "@/modules/shared/format";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const file = form.getAll("file").find((f): f is File => f instanceof File);
  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const { blob, fileName } = await maybeConvertHeic(file, file.name);
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mime = blob.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64}`;

    const extracted = await extractTaskFromImage(dataUrl);

    // Normalize state/zip
    if (extracted.state) {
      extracted.state = normalizeState(extracted.state) ?? extracted.state;
    }
    if (extracted.zip) {
      extracted.zip = normalizeZip(extracted.zip) ?? extracted.zip;
    }

    return NextResponse.json({
      extracted,
      fileName,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Extraction failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
