import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server";
import {
  submitSupportTicket,
  uploadSupportScreenshot,
  type SupportScreenshot,
} from "@/modules/support/server";

export const runtime = "nodejs";
// multipart/form-data with attachments requires the Node runtime (Edge's
// File handling is a subset and the Resend SDK pulls in node: modules).

/** Per-submission limits — deliberately conservative. Support tickets
 *  that need to transfer a gigabyte of logs should go through a
 *  dedicated channel; this endpoint is for quick "here's a screenshot
 *  of the bug" flows. */
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB each
const MAX_MESSAGE_CHARS = 5000;
const MAX_SUBJECT_CHARS = 160;
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
]);

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 415 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse form: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  const subjectRaw = (form.get("subject") ?? "").toString().trim();
  const messageRaw = (form.get("message") ?? "").toString().trim();
  // Reply-to defaults to the authenticated user's email, but we let the
  // caller override it explicitly in case the operator wants replies to
  // go to a shared inbox. Always validated to prevent header injection.
  const replyToOverride = (form.get("reply_to") ?? "").toString().trim();
  const sourcePath = (form.get("source_path") ?? "").toString().trim() || null;

  if (!subjectRaw) {
    return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  }
  if (subjectRaw.length > MAX_SUBJECT_CHARS) {
    return NextResponse.json(
      { error: `Subject must be under ${MAX_SUBJECT_CHARS} characters.` },
      { status: 400 }
    );
  }
  if (!messageRaw) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (messageRaw.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message must be under ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 }
    );
  }

  const replyTo = sanitizeEmail(replyToOverride) || auth.email;
  if (!replyTo) {
    return NextResponse.json(
      {
        error:
          "We couldn't find a reply-to email for you. Verify your account email or provide one in the form.",
      },
      { status: 400 }
    );
  }

  const fileEntries = form.getAll("screenshots").filter((v): v is File => v instanceof File);
  if (fileEntries.length > MAX_FILES) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES} screenshots per ticket.` },
      { status: 400 }
    );
  }
  for (const f of fileEntries) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${f.name}" is over the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit.` },
        { status: 400 }
      );
    }
    if (f.type && !ACCEPTED_TYPES.has(f.type.toLowerCase())) {
      return NextResponse.json(
        {
          error: `"${f.name}" has unsupported type ${f.type}. Accepted: PNG, JPEG, WebP, HEIC, GIF, PDF.`,
        },
        { status: 415 }
      );
    }
  }

  // Upload before we insert the ticket so the row points at real paths.
  // If any upload fails we bail out — no ticket row, no partial state,
  // and the already-uploaded files are orphaned but in a private bucket
  // so nobody sees them (a future cron can GC orphans by path prefix).
  const folder = `tickets/${auth.workspaceId}/${Date.now()}-${crypto.randomUUID()}`;
  const uploaded: SupportScreenshot[] = [];
  try {
    for (let i = 0; i < fileEntries.length; i += 1) {
      const f = fileEntries[i];
      const result = await uploadSupportScreenshot(f, f.name || `image-${i}`, folder, i);
      uploaded.push(result);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const userAgent = req.headers.get("user-agent");
  try {
    const result = await submitSupportTicket({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      replyTo,
      subject: subjectRaw,
      message: messageRaw,
      screenshots: uploaded,
      userAgent,
      sourcePath,
    });
    return NextResponse.json({
      ok: true,
      ticketId: result.ticketId,
      emailStatus: result.emailStatus,
      emailError: result.emailError ?? null,
      screenshots: uploaded.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not record ticket: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * Strict email sanitization — reject anything with CR/LF to prevent
 * header injection into the outgoing `Reply-To`, and require a basic
 * shape. Empty string when invalid.
 */
function sanitizeEmail(raw: string): string {
  if (!raw) return "";
  if (/[\r\n]/.test(raw)) return "";
  // Lenient check: local@domain.tld with no whitespace. Not a full
  // RFC5322 parse — the Resend SDK will reject anything truly malformed
  // downstream, and we only use this value in the Reply-To header.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return "";
  return raw;
}
