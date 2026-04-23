// Client-safe barrel for the billing module.
//
// Only the BillingSummary card is exposed here. Server-only helpers
// (getBillingState / stripe / priceIds / ...) live under
// @/modules/billing/server.

export { BillingSummary } from "./ui/BillingSummary";
