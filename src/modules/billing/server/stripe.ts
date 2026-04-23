import "server-only";
import Stripe from "stripe";

/**
 * Centralized Stripe SDK instance. Reading from env lazily so the module
 * can be imported in places that don't actually hit Stripe (e.g. a shared
 * types file).
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      // Use the SDK's default pinned API version — the Stripe docs
      // recommend this over passing apiVersion explicitly so dashboard
      // upgrades happen atomically with SDK upgrades.
      typescript: true,
      appInfo: {
        name: "LeadFlow",
        url: "https://lead-intake-sooty.vercel.app",
      },
    });
  }
  return _stripe;
}

/**
 * Price IDs configured per tier. Flat pricing: one recurring price per
 * tier covers the whole workspace. No per-seat add-on.
 *
 * Set these in Vercel env after creating the products in Stripe dashboard.
 */
export function priceIds() {
  return {
    starter: {
      base: requireEnv("STRIPE_PRICE_STARTER_BASE"),
    },
    pro: {
      base: requireEnv("STRIPE_PRICE_PRO_BASE"),
    },
  };
}

/**
 * Given a subscription from Stripe, figure out which plan it maps to
 * by inspecting the price IDs on its items. Returns null if none of the
 * known tier products match (should only happen if the Stripe dashboard
 * is misconfigured).
 */
export function inferPlanFromSubscription(
  sub: Stripe.Subscription
): "starter" | "pro" | null {
  const ids = priceIds();
  for (const item of sub.items.data) {
    const pid = item.price.id;
    if (pid === ids.starter.base) return "starter";
    if (pid === ids.pro.base) return "pro";
  }
  return null;
}
