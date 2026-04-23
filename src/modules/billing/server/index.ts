// Server-only surface of the billing module.
//
// Split out from @/modules/billing so the main barrel can stay
// client-safe. ./billing and ./stripe both have `import "server-only"`
// at the top; re-exporting from them in the main barrel drags those
// side effects into any client bundle that imports BillingSummary.

import "server-only";

export {
  getBillingState,
  getUploadsInLastDay,
  planLabel,
  monthlyPrice,
  PRICING,
  type BillingState,
  type WorkspacePlan,
  type SubscriptionStatus,
} from "./billing";

export {
  stripe,
  priceIds,
  inferPlanFromSubscription,
} from "./stripe";
