import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { PageHeader } from "@/components/PageHeader";
import { StandaloneLeadCard } from "@/modules/leads";
import type { Lead } from "@/modules/leads";

/**
 * Per-lead view/edit page. Reached from:
 *
 *   • The Route tab's estimate-card arrow (the user asked that it open
 *     THIS lead, not a generic /leads filter). The previous behavior
 *     routed to `/leads?lead=...`, which the listing page ignored.
 *   • Direct deep-linking (e.g. a dispatcher bookmarking one
 *     problematic lead).
 *
 * Renders the same LeadCard the main table does, backed by
 * StandaloneLeadCard so edits flow through the identical PATCH /
 * autosave / offline-queue paths. No data duplication, no separate UI
 * to keep in sync.
 */
export default async function LeadViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireMembership();
  // requireMembership returns a NextResponse on unauth; the App Router
  // can't render a Response from a page, so redirect to /login instead.
  if (auth instanceof Response) {
    redirect(`/login?next=${encodeURIComponent(`/leads/${id}`)}`);
  }

  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!lead) notFound();

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-4 space-y-4">
      <PageHeader title="Lead" />
      <div className="flex items-center gap-2">
        <Link
          href="/route"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Route
        </Link>
      </div>
      <StandaloneLeadCard initialLead={lead as Lead} />
    </div>
  );
}
