import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/modules/shared/supabase/server";

/**
 * Support ticket email forwarding.
 *
 * Design choices:
 *
 *   • Tickets are persisted to `public.support_tickets` as the source
 *     of truth — email is strictly a notification. If Resend (or any
 *     future transport) is misconfigured the ticket still exists and
 *     can be recovered by querying the table.
 *   • Screenshots live in the `support-screenshots` bucket and are
 *     linked from the email via short-lived signed URLs. We do NOT
 *     attach the raw bytes: the Resend attachment cap is low enough
 *     (40 MB / message) that a few iPhone screenshots can blow past
 *     it, and signed URLs survive email forwarding better than
 *     multipart MIME in many clients.
 *   • The inbox is hard-coded to `arborstarjax@gmail.com` per David's
 *     request. If that changes it's a one-line edit here; no env var
 *     because the value is not secret and not environment-specific.
 */
export const SUPPORT_INBOX = "arborstarjax@gmail.com";

export const SUPPORT_BUCKET = "support-screenshots";

/** Preferred Resend "from" identity. Resend requires a verified domain;
 *  until one is configured we fall back to the platform-provided
 *  `onboarding@resend.dev` so the feature works on day one. Override
 *  with SUPPORT_EMAIL_FROM once a domain is verified. */
function resolveFromAddress(): string {
  return process.env.SUPPORT_EMAIL_FROM?.trim() || "LeadFlow Support <onboarding@resend.dev>";
}

export type SupportScreenshot = {
  path: string; // bucket-relative path, e.g. "tickets/<uuid>/0.png"
  signedUrl: string | null; // null when signing fails; still linked in the email as a note
  filename: string;
  contentType: string;
  bytes: number;
};

export type SupportTicketInput = {
  workspaceId: string;
  userId: string;
  replyTo: string;
  subject: string;
  message: string;
  screenshots: SupportScreenshot[];
  userAgent: string | null;
  sourcePath: string | null;
};

export type SupportTicketResult = {
  ticketId: string;
  emailStatus: "sent" | "failed" | "skipped";
  emailError?: string;
};

/**
 * Persist a support ticket and (best-effort) forward it to the
 * SUPPORT_INBOX. Always returns a ticketId; `emailStatus` reports
 * what happened on the transport side so the client can show a
 * fitting toast ("We got your message" vs "We got your message but
 * email delivery is pending — we'll see it in the database").
 */
export async function submitSupportTicket(
  input: SupportTicketInput
): Promise<SupportTicketResult> {
  const admin = createAdminClient();
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      reply_to: input.replyTo,
      subject: input.subject,
      message: input.message,
      screenshot_paths: input.screenshots.map((s) => s.path),
      user_agent: input.userAgent,
      source_path: input.sourcePath,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to record support ticket: ${error.message}`);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    await admin
      .from("support_tickets")
      .update({
        email_status: "skipped",
        email_error: "RESEND_API_KEY not configured",
      })
      .eq("id", ticket.id);
    return { ticketId: ticket.id, emailStatus: "skipped" };
  }

  try {
    const resend = new Resend(apiKey);
    const html = renderEmailHtml(input);
    const text = renderEmailText(input);
    const res = await resend.emails.send({
      from: resolveFromAddress(),
      to: [SUPPORT_INBOX],
      replyTo: input.replyTo,
      subject: `[LeadFlow Support] ${input.subject}`,
      html,
      text,
    });
    if (res.error) {
      const msg = res.error.message ?? String(res.error);
      await admin
        .from("support_tickets")
        .update({ email_status: "failed", email_error: msg })
        .eq("id", ticket.id);
      return { ticketId: ticket.id, emailStatus: "failed", emailError: msg };
    }
    await admin
      .from("support_tickets")
      .update({ email_status: "sent", email_error: null })
      .eq("id", ticket.id);
    return { ticketId: ticket.id, emailStatus: "sent" };
  } catch (e) {
    const msg = (e as Error).message || "Unknown send failure";
    await admin
      .from("support_tickets")
      .update({ email_status: "failed", email_error: msg })
      .eq("id", ticket.id);
    return { ticketId: ticket.id, emailStatus: "failed", emailError: msg };
  }
}

/**
 * Upload a single screenshot to the support bucket, scoped under the
 * ticket folder. Returns both the storage path (saved in the ticket
 * row) and a short-lived signed URL suitable for a support inbox
 * (valid 7 days — long enough that support can review screenshots in
 * a delayed triage queue without us having to re-sign on every read).
 */
export async function uploadSupportScreenshot(
  file: Blob,
  filename: string,
  ticketFolder: string,
  index: number
): Promise<SupportScreenshot> {
  const admin = createAdminClient();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "image";
  const path = `${ticketFolder}/${index}-${safeName}`;
  const bytes = await file.arrayBuffer();
  const { error: upErr } = await admin.storage
    .from(SUPPORT_BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(`Failed to upload ${safeName}: ${upErr.message}`);

  const { data: signed } = await admin.storage
    .from(SUPPORT_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return {
    path,
    signedUrl: signed?.signedUrl ?? null,
    filename: safeName,
    contentType: file.type || "application/octet-stream",
    bytes: file.size,
  };
}

function renderEmailText(input: SupportTicketInput): string {
  const lines = [
    `New support request from ${input.replyTo}`,
    "",
    `Subject: ${input.subject}`,
    "",
    input.message,
    "",
    "---",
    `Workspace: ${input.workspaceId}`,
    `User: ${input.userId}`,
    input.sourcePath ? `From page: ${input.sourcePath}` : null,
    input.userAgent ? `User agent: ${input.userAgent}` : null,
    // Drop null entries only — empty strings in the array above are
    // intentional blank-line separators between sections. A naive
    // `filter(Boolean)` would swallow them and collapse header /
    // subject / body / metadata into an unreadable wall of text.
  ].filter((line): line is string => line !== null);
  if (input.screenshots.length > 0) {
    lines.push("");
    lines.push(`Screenshots (${input.screenshots.length}):`);
    for (const s of input.screenshots) {
      lines.push(
        `  • ${s.filename} (${formatBytes(s.bytes)}): ${s.signedUrl ?? "(signing failed — check bucket: " + SUPPORT_BUCKET + "/" + s.path + ")"}`
      );
    }
  }
  return lines.join("\n");
}

function renderEmailHtml(input: SupportTicketInput): string {
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const attachments =
    input.screenshots.length > 0
      ? `<h3 style="margin:16px 0 8px;font-size:14px;">Screenshots (${input.screenshots.length})</h3>
         <ul style="padding-left:18px;margin:0;">` +
        input.screenshots
          .map(
            (s) =>
              `<li style="margin-bottom:6px;font-size:13px;">
                ${s.signedUrl ? `<a href="${escape(s.signedUrl)}">${escape(s.filename)}</a>` : escape(s.filename)}
                <span style="color:#6b7280;"> — ${formatBytes(s.bytes)}</span>
              </li>`
          )
          .join("") +
        `</ul>`
      : "";

  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f4;padding:24px;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">LeadFlow Support</div>
    <h1 style="font-size:18px;margin:4px 0 12px;">${escape(input.subject)}</h1>
    <div style="font-size:13px;color:#475569;margin-bottom:12px;">From <a href="mailto:${escape(input.replyTo)}">${escape(input.replyTo)}</a></div>
    <div style="font-size:14px;line-height:1.5;white-space:pre-wrap;border-top:1px solid #e5e7eb;padding-top:12px;">${escape(input.message)}</div>
    ${attachments}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
    <div style="font-size:11px;color:#64748b;line-height:1.5;">
      Workspace: <code>${escape(input.workspaceId)}</code><br/>
      User: <code>${escape(input.userId)}</code><br/>
      ${input.sourcePath ? `Page: <code>${escape(input.sourcePath)}</code><br/>` : ""}
      ${input.userAgent ? `UA: <code>${escape(input.userAgent)}</code>` : ""}
    </div>
  </div>
</body>
</html>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
