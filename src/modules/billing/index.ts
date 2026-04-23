// Barrel for the billing module.
//
// Billing state lives in two places: `server/billing.ts` resolves the
// derived WorkspacePlan / SubscriptionStatus / trial + cycle countdowns
// / uploads-today counter, and `server/stripe.ts` wraps the Stripe
// SDK (priceIds() + inferPlanFromSubscription + stripe() singleton).
// The Stripe webhook delivery handler stays at its Next.js route path
// under src/app/api/stripe/webhook/ and becomes a thin delegator in
// R-9.
//
// BillingSummary renders the trial / cycle / uploads meter on
// /workspace. A separate /billing page still owns its own plan-compare
// card; those UIs fold into this module in R-9.

export {
  getBillingState,
  getUploadsInLastDay,
  planLabel,
  monthlyPrice,
  PRICING,
  type BillingState,
  type WorkspacePlan,
  type SubscriptionStatus,
} from "./server/billing";

export {
  stripe,
  priceIds,
  inferPlanFromSubscription,
} from "./server/stripe";

export { BillingSummary } from "./ui/BillingSummary";
