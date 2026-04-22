import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type WorkspacePlan = "trial" | "starter" | "pro" | "free";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export type BillingState = {
  workspaceId: string;
  plan: WorkspacePlan;
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  dataRetentionDeadline: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  seatCount: number;
  /** True if the workspace is currently allowed to perform paid actions
   *  (ingest, schedule, etc). False means show a paywall. */
  canUsePaidFeatures: boolean;
  /** True if the workspace has unlimited uploads (Pro tier). */
  unlimitedUploads: boolean;
  /** Days remaining on the free trial; null if not in trial. */
  trialDaysRemaining: number | null;
  /** True if trial is within the 3-day "ending soon" window. */
  trialEndingSoon: boolean;
};

type WorkspaceRow = {
  id: string;
  plan: WorkspacePlan;
  subscription_status: SubscriptionStatus | null;
  trial_ends_at: string | null;
  subscription_current_period_end: string | null;
  cancel_at_period_end: boolean;
  data_retention_deadline: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

/**
 * Compute the billing state for a workspace. Called from any page or API
 * route that needs to gate on subscription status.
 *
 * Uses the admin client so this bypasses RLS — callers MUST already have
 * verified the requester has access to the workspace (e.g. via
 * requireMembership).
 */
export async function getBillingState(
  workspaceId: string
): Promise<BillingState> {
  const admin = createAdminClient();

  const [workspaceRes, memberCountRes] = await Promise.all([
    admin
      .from("workspaces")
      .select(
        "id, plan, subscription_status, trial_ends_at, subscription_current_period_end, cancel_at_period_end, data_retention_deadline, stripe_customer_id, stripe_subscription_id"
      )
      .eq("id", workspaceId)
      .maybeSingle<WorkspaceRow>(),
    admin
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  // Surface the underlying Postgres error if the query failed (e.g. missing
  // column after a partial migration). Previously we only checked .data,
  // which collapsed any error into a misleading "workspace not found".
  if (workspaceRes.error) {
    throw new Error(
      `getBillingState: workspace lookup failed for ${workspaceId}: ${workspaceRes.error.message}`
    );
  }
  const row = workspaceRes.data;
  if (!row) {
    throw new Error(`workspace not found: ${workspaceId}`);
  }

  const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const currentPeriodEnd = row.subscription_current_period_end
    ? new Date(row.subscription_current_period_end)
    : null;
  const dataRetentionDeadline = row.data_retention_deadline
    ? new Date(row.data_retention_deadline)
    : null;
  const now = Date.now();

  // Trial math — negative days means trial already ended.
  const trialDaysRemaining = trialEndsAt
    ? Math.ceil((trialEndsAt.getTime() - now) / (1000 * 60 * 60 * 24))
    : null;

  // Strictly positive: once the trial has actually expired, the expired
  // copy in CurrentPlanCard handles messaging — we don't want the
  // "ends in 0 days" banner rendering alongside "Expired".
  const trialEndingSoon =
    row.plan === "trial" &&
    trialDaysRemaining !== null &&
    trialDaysRemaining <= 3 &&
    trialDaysRemaining > 0;

  // Paid-features gate:
  //   - trial that hasn't expired yet → allowed
  //   - starter / pro with trialing or active status → allowed
  //   - anything else (free, past_due, canceled, expired trial) → blocked
  let canUsePaidFeatures = false;
  if (row.plan === "trial") {
    canUsePaidFeatures =
      trialEndsAt !== null && trialEndsAt.getTime() > now;
  } else if (row.plan === "starter" || row.plan === "pro") {
    canUsePaidFeatures =
      row.subscription_status === "active" ||
      row.subscription_status === "trialing";
  }

  return {
    workspaceId: row.id,
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    trialEndsAt,
    currentPeriodEnd,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    dataRetentionDeadline,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    seatCount: memberCountRes.count ?? 0,
    canUsePaidFeatures,
    unlimitedUploads: row.plan === "pro" && canUsePaidFeatures,
    trialDaysRemaining,
    trialEndingSoon,
  };
}

/**
 * Human-readable label for a plan. Kept here so UI + emails stay in sync.
 */
export function planLabel(plan: WorkspacePlan): string {
  switch (plan) {
    case "trial":
      return "Free trial";
    case "starter":
      return "Starter";
    case "pro":
      return "Pro";
    case "free":
      return "Canceled";
  }
}

/**
 * Pricing constants mirrored from Stripe. Centralized here so we don't
 * hard-code them across components.
 *
 * Flat-per-workspace pricing: one recurring price per tier, all members
 * of the workspace are covered under it (no per-seat add-on).
 */
export const PRICING = {
  starter: {
    base: 29.99,
    uploadsPerDay: 50,
  },
  pro: {
    base: 59.99,
    uploadsPerDay: null, // unlimited
  },
} as const;

/**
 * Monthly charge for a plan. Flat — seat count doesn't affect billing.
 * Kept as a function so callers don't need to know the pricing shape.
 */
export function monthlyPrice(plan: "starter" | "pro"): number {
  return PRICING[plan].base;
}
