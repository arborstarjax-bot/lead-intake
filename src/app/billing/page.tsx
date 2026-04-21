import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { getSessionMembership } from "@/lib/auth";
import {
  getBillingState,
  monthlyPrice,
  planLabel,
  PRICING,
  type BillingState,
} from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const auth = await getSessionMembership();
  if (!auth) redirect("/login?next=/billing");

  const billing = await getBillingState(auth.workspaceId);
  const isAdmin = auth.role === "admin";

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Billing</h1>
        <span className="text-xs text-[var(--muted)]">{auth.email}</span>
      </header>

      {billing.trialEndingSoon && (
        <TrialEndingBanner billing={billing} isAdmin={isAdmin} />
      )}

      {billing.plan === "free" && <LapsedBanner billing={billing} />}

      <CurrentPlanCard billing={billing} workspaceName={auth.workspaceName} />

      {!isAdmin && (
        <p className="text-sm text-[var(--muted)] px-1">
          Only workspace admins can change the plan or manage billing.
        </p>
      )}

      {isAdmin && <PlanCompareCard billing={billing} />}
    </main>
  );
}

function CurrentPlanCard({
  billing,
  workspaceName,
}: {
  billing: BillingState;
  workspaceName: string;
}) {
  const isPaid = billing.plan === "starter" || billing.plan === "pro";
  const price =
    isPaid && (billing.plan === "starter" || billing.plan === "pro")
      ? monthlyPrice(billing.plan, billing.seatCount)
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
          <dt className="text-[var(--muted)]">Uploads / day</dt>
          <dd className="font-medium">
            {billing.unlimitedUploads
              ? "Unlimited"
              : `${PRICING.starter.uploadsPerDay} / workspace`}
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
              ${price.toFixed(2)}
              {billing.seatCount > 1 && (
                <span className="text-[var(--muted)] font-normal">
                  {" "}
                  (${(PRICING[billing.plan as "starter" | "pro"].base).toFixed(2)} +{" "}
                  {billing.seatCount - 1} × $9.99)
                </span>
              )}
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

      <p className="text-xs text-[var(--muted)]">
        Payment management coming soon. For now, contact support to change
        your plan or cancel.
      </p>
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

function LapsedBanner({ billing }: { billing: BillingState }) {
  const deadline = billing.dataRetentionDeadline;
  const daysLeft = deadline
    ? Math.max(
        0,
        Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      )
    : null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 text-red-900 p-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="text-sm">
        <div className="font-semibold">Subscription canceled</div>
        <div className="mt-1 opacity-90">
          Your workspace is read-only.
          {daysLeft !== null && (
            <>
              {" "}
              Data will be deleted in {daysLeft} day
              {daysLeft === 1 ? "" : "s"} unless you reactivate.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanCompareCard({ billing }: { billing: BillingState }) {
  const currentPlan = billing.plan;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Plans
        </div>
        <h2 className="text-base font-semibold mt-0.5">Compare tiers</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PlanTile
          name="Starter"
          price="$29.99/mo"
          seatAddon="$9.99 per additional user"
          features={[
            "30 uploads / day (shared across workspace)",
            "1 seat included",
            "Unlimited members (add seats as needed)",
            "Calendar + SMS automation",
          ]}
          current={currentPlan === "starter"}
          isTrial={currentPlan === "trial"}
        />
        <PlanTile
          name="Pro"
          price="$59.99/mo"
          seatAddon="$9.99 per additional user"
          features={[
            "Unlimited uploads",
            "1 seat included",
            "Unlimited members (add seats as needed)",
            "Everything in Starter",
          ]}
          highlight
          current={currentPlan === "pro"}
          isTrial={currentPlan === "trial"}
        />
      </div>

      <p className="text-xs text-[var(--muted)]">
        Both tiers include a 14-day free trial. Upgrade at any time — we only
        charge once the trial ends.
      </p>
    </section>
  );
}

function PlanTile({
  name,
  price,
  seatAddon,
  features,
  highlight,
  current,
  isTrial,
}: {
  name: string;
  price: string;
  seatAddon: string;
  features: string[];
  highlight?: boolean;
  current: boolean;
  isTrial: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        highlight
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/20 bg-[var(--accent-soft)]/40"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{name}</span>
            {highlight && (
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            )}
          </div>
          <div className="text-lg font-semibold mt-0.5">{price}</div>
          <div className="text-xs text-[var(--muted)]">{seatAddon}</div>
        </div>
        {current && (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
            Current
          </span>
        )}
      </div>
      <ul className="space-y-1.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled
        className="w-full px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium opacity-50 cursor-not-allowed"
        title="Coming soon"
      >
        {current
          ? "Current plan"
          : isTrial
            ? `Start ${name}`
            : `Switch to ${name}`}
      </button>
    </div>
  );
}
