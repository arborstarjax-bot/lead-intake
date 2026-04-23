import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Globe } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { getSessionMembership } from "@/modules/auth/server";
import {
  getBillingState,
  getUploadsInLastDay,
  monthlyPrice,
  planLabel,
  PRICING,
  type BillingState,
} from "@/modules/billing/server";
import { isIosShellRequest } from "@/lib/ios-shell-server";
import { PlanCompareCard } from "./PlanCompareCard";
import { ManageBillingButton } from "./ManageBillingButton";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ status?: string }>;
};

export default async function BillingPage({ searchParams }: Props) {
  const auth = await getSessionMembership();
  if (!auth) redirect("/login?next=/billing");

  const [billing, uploadsToday, params, inShell] = await Promise.all([
    getBillingState(auth.workspaceId),
    getUploadsInLastDay(auth.workspaceId),
    searchParams,
    isIosShellRequest(),
  ]);
  const isAdmin = auth.role === "admin";

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Billing"
        rightSlot={
          <span className="text-xs text-[var(--muted)] truncate max-w-[10rem] hidden sm:inline">
            {auth.email}
          </span>
        }
      />

      {params.status === "success" && <CheckoutSuccessBanner />}
      {params.status === "canceled" && <CheckoutCanceledBanner />}

      {billing.trialEndingSoon && (
        <TrialEndingBanner billing={billing} isAdmin={isAdmin} />
      )}

      {billing.subscriptionStatus === "past_due" && (
        <PastDueBanner billing={billing} isAdmin={isAdmin} />
      )}

      {billing.plan === "free" && (
        <LapsedBanner billing={billing} isAdmin={isAdmin} />
      )}

      <CurrentPlanCard
        billing={billing}
        workspaceName={auth.workspaceName}
        isAdmin={isAdmin}
        inShell={inShell}
        uploadsToday={uploadsToday}
      />

      {!isAdmin && (
        <p className="text-sm text-[var(--muted)] px-1">
          Only workspace admins can change the plan or manage billing.
        </p>
      )}

      {/* App Store Guideline 3.1.1 gate: the Capacitor iOS shell can't
          present Stripe purchase or billing-management UI. We qualify
          for the 3.1.3(b) business-services exemption, which requires
          that accounts be provisioned and managed outside the app.
          See src/lib/ios-shell.ts for the detection + rationale. */}
      {isAdmin && inShell && <WebManagedBillingNote />}
      {isAdmin && !inShell && <PlanCompareCard billing={billing} />}
    </main>
  );
}

function WebManagedBillingNote() {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <Globe className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            Manage your subscription on the web
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Plans, payment methods, and invoices for your LeadFlow
            workspace are managed from your web browser. Open LeadFlow
            on a computer or mobile browser to change plans or update
            billing details — the iOS app picks up the changes
            automatically.
          </p>
        </div>
      </div>
    </section>
  );
}

function CheckoutSuccessBanner() {
  return (
    <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-hover)] p-4 flex items-start gap-3">
      <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm">
        <div className="font-semibold">You&apos;re all set</div>
        <div className="mt-1 opacity-90">
          Your plan will refresh in a moment. If it doesn&apos;t update, reload
          this page — Stripe notifies us via webhook.
        </div>
      </div>
    </div>
  );
}

function CheckoutCanceledBanner() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] p-4 text-sm">
      Checkout canceled. Your plan hasn&apos;t changed.
    </div>
  );
}

function CurrentPlanCard({
  billing,
  workspaceName,
  isAdmin,
  inShell,
  uploadsToday,
}: {
  billing: BillingState;
  workspaceName: string;
  isAdmin: boolean;
  inShell: boolean;
  uploadsToday: number;
}) {
  const price =
    billing.plan === "starter" || billing.plan === "pro"
      ? monthlyPrice(billing.plan)
      : null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Current plan
          </div>
          <div className="text-lg font-semibold mt-0.5">
            {planLabel(billing.plan)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Workspace
          </div>
          <div className="text-sm mt-0.5">{workspaceName}</div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[var(--muted)]">Seats</dt>
          <dd className="font-medium">{billing.seatCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Uploads today</dt>
          <dd className="font-medium tabular-nums">
            {/* Pro keeps its own 'unlimited' line even on past_due so it
                still reads as the Pro plan. Lapsed (free) and expired
                trials must NOT show 'N / 50' — the ingest gate blocks
                them at 0 regardless of the cap, and rendering the
                fraction misleads users into thinking they have quota. */}
            {billing.plan === "pro"
              ? `${uploadsToday} · unlimited`
              : billing.plan === "free"
              ? "Paused"
              : billing.plan === "trial" && !billing.canUsePaidFeatures
              ? "Trial ended"
              : `${uploadsToday} / ${PRICING.starter.uploadsPerDay}`}
          </dd>
        </div>

        {billing.plan === "trial" && billing.trialDaysRemaining !== null && (
          <div className="col-span-2">
            <dt className="text-[var(--muted)]">Trial</dt>
            <dd className="font-medium">
              {billing.trialDaysRemaining > 0
                ? `${billing.trialDaysRemaining} day${billing.trialDaysRemaining === 1 ? "" : "s"} remaining`
                : "Expired"}
            </dd>
          </div>
        )}

        {price !== null && (
          <div className="col-span-2">
            <dt className="text-[var(--muted)]">Monthly charge</dt>
            <dd className="font-medium">
              ${price.toFixed(2)}{" "}
              <span className="text-[var(--muted)] font-normal">
                flat — all users included
              </span>
            </dd>
          </div>
        )}

        {billing.currentPeriodEnd && (
          <div className="col-span-2">
            <dt className="text-[var(--muted)]">
              {billing.cancelAtPeriodEnd ? "Ends on" : "Next invoice"}
            </dt>
            <dd className="font-medium">
              {billing.currentPeriodEnd.toLocaleDateString()}
            </dd>
          </div>
        )}
      </dl>

      {isAdmin && billing.stripeCustomerId && !inShell && (
        <div className="pt-1 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[var(--muted)]">
            Update your card, download invoices, or cancel anytime in the
            Stripe billing portal.
          </p>
          <ManageBillingButton />
        </div>
      )}
    </section>
  );
}

function TrialEndingBanner({
  billing,
  isAdmin,
}: {
  billing: BillingState;
  isAdmin: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm">
        <div className="font-semibold">
          Trial ends in {billing.trialDaysRemaining} day
          {billing.trialDaysRemaining === 1 ? "" : "s"}
        </div>
        <div className="mt-1 opacity-90">
          {isAdmin
            ? "Upgrade to Starter or Pro to keep using LeadFlow without interruption."
            : "Ask a workspace admin to upgrade before the trial ends."}
        </div>
      </div>
    </div>
  );
}

function PastDueBanner({
  billing,
  isAdmin,
}: {
  billing: BillingState;
  isAdmin: boolean;
}) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 text-red-900 p-4 flex flex-col sm:flex-row sm:items-start gap-3">
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm flex-1 space-y-1">
        <div className="font-semibold">Payment failed</div>
        <div className="opacity-90">
          {isAdmin
            ? "Your last charge didn't go through. Update your payment method to avoid losing access."
            : "Ask a workspace admin to update the payment method to avoid losing access."}
        </div>
      </div>
      {isAdmin && billing.stripeCustomerId && (
        <div className="shrink-0 sm:self-center">
          <ManageBillingButton
            label="Update payment method"
            variant="primary"
          />
        </div>
      )}
    </div>
  );
}

function LapsedBanner({
  billing,
  isAdmin,
}: {
  billing: BillingState;
  isAdmin: boolean;
}) {
  const deadline = billing.dataRetentionDeadline;
  const daysLeft = deadline
    ? Math.max(
        0,
        Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      )
    : null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 text-red-900 p-4 flex flex-col sm:flex-row sm:items-start gap-3">
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm flex-1 space-y-1">
        <div className="font-semibold">Subscription canceled</div>
        <div className="opacity-90">
          Your workspace is read-only.
          {daysLeft !== null && (
            <>
              {" "}
              Data will be deleted in {daysLeft} day
              {daysLeft === 1 ? "" : "s"} unless you reactivate.
            </>
          )}
        </div>
        {isAdmin && (
          <div className="opacity-90">
            Pick a plan below to reactivate immediately.
          </div>
        )}
      </div>
    </div>
  );
}
