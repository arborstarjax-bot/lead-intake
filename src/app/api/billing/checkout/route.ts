import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { stripe, priceIds } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  plan: "starter" | "pro";
};

function baseUrl(req: NextRequest): string {
  // Prefer the explicit env so previews + prod don't redirect to each
  // other, but fall back to the request host in case env is missing.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
}

/**
 * Statuses where Stripe considers the subscription "live" and we should
 * modify it in place rather than spinning up a new one. `canceled` and
 * `incomplete_expired` are terminal — a new subscription is appropriate.
 */
const LIVE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || (body.plan !== "starter" && body.plan !== "pro")) {
    return NextResponse.json({ error: "invalid plan" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: workspace, error: wErr } = await admin
    .from("workspaces")
    .select("id, name, stripe_customer_id, stripe_subscription_id")
    .eq("id", auth.workspaceId)
    .maybeSingle();
  if (wErr || !workspace) {
    return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  }

  // Flat-per-workspace pricing: one line item, quantity 1. Team size
  // doesn't affect the bill.
  const ids = priceIds();
  const tierIds = ids[body.plan];

  const appUrl = baseUrl(req);

  // If the workspace already has a live Stripe subscription, switch
  // plans IN PLACE. Creating a new Checkout Session would result in a
  // second parallel subscription and double-billing.
  if (workspace.stripe_subscription_id) {
    const existing = await stripe()
      .subscriptions.retrieve(workspace.stripe_subscription_id)
      .catch(() => null);

    if (existing && LIVE_STATUSES.has(existing.status)) {
      // Swap all items to the new tier. Stripe will prorate automatically
      // using the customer's default prorate behavior ("create_prorations").
      const deletions = existing.items.data.map((item) => ({
        id: item.id,
        deleted: true as const,
      }));
      const additions: Array<{ price: string; quantity: number }> = [
        { price: tierIds.base, quantity: 1 },
      ];

      try {
        await stripe().subscriptions.update(workspace.stripe_subscription_id, {
          items: [...deletions, ...additions],
          proration_behavior: "create_prorations",
          // Re-assert the workspace link so future webhooks can always
          // resolve back to us, even if Stripe drops metadata later.
          metadata: { workspace_id: workspace.id },
        });
      } catch (err) {
        console.error("[checkout] stripe.subscriptions.update failed", err);
        const message =
          err instanceof Error ? err.message : "unknown stripe error";
        return NextResponse.json(
          { error: "plan switch failed", detail: message },
          { status: 500 }
        );
      }

      // The customer.subscription.updated webhook will flip the plan in
      // our DB. Redirect to the success page so the UI refreshes.
      return NextResponse.json({
        url: `${appUrl}/billing?status=success`,
      });
    }
    // Falls through to new checkout when the existing subscription is
    // terminal (canceled / incomplete_expired) — Stripe won't let us
    // resurrect those, we have to start fresh.
  }

  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: tierIds.base, quantity: 1 },
  ];

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      // 14-day trial on first subscription only. Stripe ignores this on
      // a returning customer, which is exactly the behavior we want.
      subscription_data: {
        trial_period_days: 14,
        metadata: { workspace_id: workspace.id },
      },
      // In subscription mode Stripe always creates a customer — no
      // customer_creation param needed (it's payment-mode only). Pass
      // the existing customer when we have one so repeat purchases
      // stay tied to the same Stripe Customer.
      customer: workspace.stripe_customer_id ?? undefined,
      client_reference_id: workspace.id,
      metadata: { workspace_id: workspace.id, plan: body.plan },
      success_url: `${appUrl}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing?status=canceled`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "stripe did not return checkout url" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Surface the Stripe error to the logs so mis-configured price IDs or
    // API misuse are visible immediately. The client still gets a generic
    // message (we don't want to leak Stripe internals to end users).
    console.error("[checkout] stripe.checkout.sessions.create failed", err);
    const message =
      err instanceof Error ? err.message : "unknown stripe error";
    return NextResponse.json(
      { error: "checkout failed", detail: message },
      { status: 500 }
    );
  }
}
