"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

/**
 * Client form for the Support page. Submits a subject + message + up to
 * MAX_FILES screenshots to `/api/support`, which persists the ticket
 * and emails arborstarjax@gmail.com.
 *
 * UX choices worth noting:
 *
 *   • The file input is hidden behind a styled "Add screenshots" button
 *     so the UI doesn't drift from the rest of the app.
 *   • Selected files are shown with per-item remove buttons; re-picking
 *     merges into the existing list rather than replacing, which
 *     matches how mobile users experience share sheets (tap, tap, tap).
 *   • On success we clear the form and show a kind=success toast. If
 *     the server reports the email was only "skipped" (no RESEND_API_KEY
 *     configured in this deploy) we still say the ticket was received —
 *     the server has the row, nothing is lost — but hint that the email
 *     forwarding is pending so the user isn't surprised when nothing
 *     shows up in the inbox during development.
 */

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
];

export function SupportForm({
  defaultReplyTo,
  sourcePath,
}: {
  defaultReplyTo: string;
  sourcePath?: string;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState(defaultReplyTo);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  function handleFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    const additions: File[] = [];
    for (const f of Array.from(list)) {
      if (files.length + additions.length >= MAX_FILES) {
        toast({
          kind: "error",
          message: `You can attach at most ${MAX_FILES} files per ticket.`,
        });
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast({
          kind: "error",
          message: `"${f.name}" is over the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit.`,
        });
        continue;
      }
      if (f.type && !ACCEPTED_TYPES.includes(f.type.toLowerCase())) {
        toast({
          kind: "error",
          message: `"${f.name}" has unsupported type ${f.type}.`,
        });
        continue;
      }
      additions.push(f);
    }
    if (additions.length > 0) {
      setFiles((prev) => [...prev, ...additions]);
    }
    // Reset the input so selecting the same file twice in a row still
    // fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!subject.trim() || !message.trim()) {
      toast({ kind: "error", message: "Subject and message are required." });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("subject", subject.trim());
      fd.set("message", message.trim());
      if (replyTo.trim() && replyTo.trim() !== defaultReplyTo) {
        fd.set("reply_to", replyTo.trim());
      }
      if (sourcePath) fd.set("source_path", sourcePath);
      for (const f of files) fd.append("screenshots", f, f.name);
      const res = await fetch("/api/support", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          kind: "error",
          message: json.error ?? `Submission failed (${res.status})`,
          duration: 6000,
        });
        return;
      }
      if (json.emailStatus === "sent") {
        toast({
          kind: "success",
          message: "Thanks — your message was sent to support.",
        });
      } else if (json.emailStatus === "skipped") {
        toast({
          kind: "info",
          message:
            "We received your ticket. Email forwarding isn't configured on this deploy; support will still see it.",
          duration: 7000,
        });
      } else {
        // failed
        toast({
          kind: "info",
          message:
            "We saved your ticket but email delivery is still retrying. You don't need to resubmit.",
          duration: 7000,
        });
      }
      setSubject("");
      setMessage("");
      setFiles([]);
    } catch (e) {
      toast({
        kind: "error",
        message: `Couldn't reach the server: ${(e as Error).message}`,
        duration: 7000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="support-subject" className="block text-sm font-medium">
          Subject
        </label>
        <input
          id="support-subject"
          type="text"
          required
          maxLength={160}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Can't schedule a lead on iPad"
          className="field-input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-message" className="block text-sm font-medium">
          How can we help?
        </label>
        <textarea
          id="support-message"
          required
          maxLength={5000}
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe what you were doing, what you expected, and what happened instead. Screenshots help a lot."
          className="field-input w-full resize-y leading-6"
        />
        <div className="text-[11px] text-[var(--muted)] text-right">
          {message.length} / 5000
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-reply-to" className="block text-sm font-medium">
          Reply to
        </label>
        <input
          id="support-reply-to"
          type="email"
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          className="field-input w-full"
        />
        <p className="text-[11px] text-[var(--muted)]">
          We&apos;ll reply to this address. Defaults to your account email.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium">Screenshots</label>
          <span className="text-[11px] text-[var(--muted)]">
            {files.length} / {MAX_FILES} · 10 MB each
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFilesPicked(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={files.length >= MAX_FILES}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 h-9 text-sm font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-60"
        >
          <Paperclip className="h-4 w-4" />
          Add screenshots
        </button>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium truncate">{f.name}</span>
                  <span className="ml-2 text-[11px] text-[var(--muted)]">
                    {formatBytes(f.size)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.name}`}
                  className="rounded-full p-1 text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] text-white h-11 text-sm font-semibold disabled:opacity-60"
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Send to support
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
