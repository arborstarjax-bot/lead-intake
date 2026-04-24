import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { getSessionMembership } from "@/modules/auth/server";
import { SUPPORT_INBOX } from "@/modules/support/server";
import { SupportForm } from "./SupportForm";

export const metadata: Metadata = {
  title: "Support · LeadFlow",
};

export const dynamic = "force-dynamic";

/**
 * /support — live alongside /billing, /privacy, /terms (linked from
 * the Workspace page footer). Collects a message + optional
 * screenshots and forwards to SUPPORT_INBOX via Resend (with the
 * ticket row persisted to Supabase as the source of truth).
 *
 * Auth'd only: anonymous visitors get bounced to /login so we always
 * have a workspace + user id to stamp on the ticket.
 */
export default async function SupportPage() {
  const auth = await getSessionMembership();
  if (!auth) redirect("/login?next=/support");

  const replyTo = auth.email ?? "";

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Support"
        rightSlot={
          <span className="text-xs text-[var(--muted)] truncate max-w-[10rem] hidden sm:inline">
            {auth.email}
          </span>
        }
      />

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] p-2">
            <Mail className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Contact support</h2>
            <p className="text-sm text-[var(--muted)]">
              Tell us what&apos;s happening and attach screenshots if you have
              them. Messages go straight to{" "}
              <a
                href={`mailto:${SUPPORT_INBOX}`}
                className="font-medium text-[var(--fg)] hover:underline"
              >
                {SUPPORT_INBOX}
              </a>
              .
            </p>
          </div>
        </div>

        <SupportForm defaultReplyTo={replyTo} sourcePath="/support" />
      </section>

      <div className="text-center text-xs text-[var(--muted)] space-x-3">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="hover:underline">
          Terms
        </Link>
      </div>
    </main>
  );
}
