import Link from "next/link";
import { AlertTriangle, CreditCard } from "lucide-react";
import {
  PRICING,
  planLabel,
  type BillingState,
} from "@/lib/billing";

type Props = {
  billing: BillingState;
  uploadsToday: number;
};

/**
 * At-a-glance subscription panel on /workspace. Mirrors the data that
 * lives on /billing but stays scoped to "what do I have left today?":
 *
 *   - Trial → days remaining
 *   - Starter/Pro → next renewal date (or cancel-at-period-end warning)
 *   - Any Starter plan → uploads-today progress bar (50/day cap)
 *   - Pro → "Unlimited uploads" confirmation
 *
 * All management actions are still on /billing; this is a read-only
 * dashboard so users don't have to context-switch to see where they
 * stand on the plan.
 */
export function BillingSummary({ billing, uploadsToday }: Props) {
  const isTrial = billing.plan === "trial";
  const isStarter = billing.plan === "starter";
  const isPro = billing.plan === "pro";
  const isLapsed = billing.plan === "free";

  const dailyCap = PRICING.starter.uploadsPerDay;
  // Clamp the displayed "used" count to the cap so a mid-flight burst
  // (e.g. a race between two clients) doesn't push the meter past 100%.
  const clampedUsed = Math.min(uploadsToday, dailyCap);
  const usagePct = Math.min(100, Math.round((clampedUsed / dailyCap) * 100));
  const atLimit = uploadsToday >= dailyCap;

  const renewal = billing.currentPeriodEnd
    ? formatDateShort(billing.currentPeriodEnd)
    : null;
  const renewalDays = billing.currentPeriodEnd
    ? daysFromNow(billing.currentPeriodEnd)
    : null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
            Subscription
          </div>
          <div className="text-lg font-semibold flex items-center gap-2">
            {planLabel(billing.plan)}
            {billing.subscriptionStatus === "past_due" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 h-6">
                <AlertTriangle className="h-3 w-3" /> Past due
              </span>
            )}
          </div>
        </div>
        <Link
          href="/billing"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 h-9 text-sm font-medium"
        >
          <CreditCard className="h-4 w-4" /> Manage
        </Link>
      </div>

      {isTrial && billing.trialDaysRemaining !== null && (
        <TrialCountdown days={billing.trialDaysRemaining} />
      )}

      {(isStarter || isPro) && renewal && renewalDays !== null && (
        <CycleCountdown
          days={renewalDays}
          renewalDate={renewal}
          cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
        />
      )}

      {isLapsed && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 text-sm">
          Your subscription has lapsed. Uploads and SMS are paused until
          you re-subscribe on the billing page.
        </div>
      )}

      {/* Usage meter. Starter always gets a bar; Pro gets a plain
          "unlimited" note so they can still see the count. Trial uses the
          Starter cap since that's what the ingest route enforces — but
          we hide the bar once the trial has expired (canUsePaidFeatures
          is false) because the ingest gate blocks all uploads and
          showing "0 / 50" would imply quota that doesn't exist. */}
      {((isTrial && billing.canUsePaidFeatures) || isStarter) && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium text-[var(--muted)]">
              Uploads today
            </div>
            <div className="text-xs font-medium tabular-nums">
              {uploadsToday} <span className="text-[var(--muted)]">/ {dailyCap}</span>
            </div>
          </div>
          <div
            className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={dailyCap}
            aria-valuenow={clampedUsed}
          >
            <div
              className={
                atLimit
                  ? "h-full bg-red-500 transition-[width]"
                  : usagePct >= 80
                  ? "h-full bg-amber-500 transition-[width]"
                  : "h-full bg-[var(--accent)] transition-[width]"
              }
              style={{ width: `${usagePct}%` }}
            />
          </div>
          {atLimit && (
            <div className="text-xs text-red-700">
              You&apos;ve hit today&apos;s limit. Uploads will resume in 24h or
              upgrade to Pro for unlimited.
            </div>
          )}
        </div>
      )}

      {isPro && (
        <div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-[var(--muted)]">Uploads today</span>
            <span className="tabular-nums font-medium">
              {uploadsToday}{" "}
              <span className="text-[var(--muted)]">/ unlimited</span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function TrialCountdown({ days }: { days: number }) {
  // days <= 0 means the trial window already closed. Paid-features gate
  // will block ingest regardless, but surface the expired state here so
  // the user isn't confused by silence.
  if (days <= 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 text-sm">
        Your free trial has ended. Subscribe on the billing page to keep
        using LeadFlow.
      </div>
    );
  }
  const urgent = days <= 3;
  return (
    <div
      className={
        urgent
          ? "rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm"
          : "rounded-xl bg-[var(--surface-2)] p-3 text-sm"
      }
    >
      <div className="font-medium">
        {days} day{days === 1 ? "" : "s"} left in free trial
      </div>
      {urgent && (
        <div className="text-xs mt-1">
          Pick a plan before the trial ends so uploads keep flowing.
        </div>
      )}
    </div>
  );
}

function CycleCountdown({
  days,
  renewalDate,
  cancelAtPeriodEnd,
}: {
  days: number;
  renewalDate: string;
  cancelAtPeriodEnd: boolean;
}) {
  if (cancelAtPeriodEnd) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
        <div className="font-medium">
          Ends in {Math.max(0, days)} day{days === 1 ? "" : "s"} on{" "}
          {renewalDate}
        </div>
        <div className="text-xs mt-1">
          Your plan is set to cancel. Reactivate from the billing page if
          you want it to keep renewing.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-[var(--muted)]">Renews in</span>
        <span className="font-medium tabular-nums">
          {Math.max(0, days)} day{days === 1 ? "" : "s"}{" "}
          <span className="text-[var(--muted)]">· {renewalDate}</span>
        </span>
      </div>
    </div>
  );
}

function daysFromNow(date: Date): number {
  return Math.max(
    0,
    Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
