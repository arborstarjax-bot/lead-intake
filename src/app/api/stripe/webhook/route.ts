import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, inferPlanFromSubscription } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import type { SubscriptionStatus, WorkspacePlan } from "@/lib/billing";

export const runtime = "nodejs";
// Stripe signs the raw bytes, so we need to read them before any JSON
// parsing. next's default body parser is off for route handlers anyway.
export const dynamic = "force-dynamic";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Idempotently record the event. Returns `true` if this is the first time
 * we're seeing it (caller should process), `false` if we've already handled
 * it (caller should no-op and return 200). Stripe retries aggressively
 * so this guard is load-bearing.
 */
async function recordEvent(
  event: Stripe.Event,
  workspaceId: string | null
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    workspace_id: workspaceId,
    payload: event as unknown as Record<string, unknown>,
  });
  if (error) {
    // Unique violation on stripe_event_id = duplicate delivery.
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

/**
 * Read workspace_id from metadata on either the subscription, its
 * customer, or the event's parent object. We set it in metadata when
 * creating the Checkout session; Stripe propagates it to the
 * subscription automatically.
 */
function getWorkspaceIdFromEvent(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const metadata = (obj.metadata ?? {}) as Record<string, string>;
  if (metadata.workspace_id) return metadata.workspace_id;

  // Fallbacks for events where metadata lives on a nested object.
  if (obj.subscription_details) {
    const details = obj.subscription_details as { metadata?: Record<string, string> };
    if (details.metadata?.workspace_id) return details.metadata.workspace_id;
  }
  return null;
}

/**
 * Map a Stripe subscription.status to our narrower enum.
 * Stripe has more statuses than we care about; normalize aggressively.
 */
/**
 * Extract the subscription id from an invoice. In API 2026-03-25 this
 * moved from `invoice.subscription` to `invoice.parent.subscription_details.subscription`.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (typeof sub === "string") return sub;
  if (sub && typeof sub === "object" && "id" in sub) return sub.id;
  return null;
}

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "incomplete";
  }
}

/**
 * In Stripe API 2026-03-25 and later, `current_period_end` lives on each
 * subscription item, not the subscription itself. We use the max across
 * items so a subscription with mixed cycles (shouldn't happen with our
 * setup, but defensive) still reports the latest renewal.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  let max: number | null = null;
  for (const item of sub.items.data) {
    const end = item.current_period_end;
    if (typeof end === "number" && (max === null || end > max)) max = end;
  }
  return max;
}

async function applySubscriptionToWorkspace(
  workspaceId: string,
  sub: Stripe.Subscription
) {
  const admin = createAdminClient();
  const plan = inferPlanFromSubscription(sub);
  const status = mapStatus(sub.status);

  const periodEnd = subscriptionPeriodEnd(sub);
  const updates: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: status,
    cancel_at_period_end: sub.cancel_at_period_end,
    subscription_current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  };

  if (typeof sub.customer === "string") {
    updates.stripe_customer_id = sub.customer;
  }

  // If the status tells us the workspace is in a paid-active state and
  // the price items resolve to a tier, lift the plan. Otherwise leave
  // the plan column alone — e.g. 'canceled' events handle plan='free'
  // explicitly below.
  if (plan && (status === "active" || status === "trialing")) {
    updates.plan = plan satisfies WorkspacePlan;
    updates.data_retention_deadline = null;
  }

  const { error } = await admin
    .from("workspaces")
    .update(updates)
    .eq("id", workspaceId);
  if (error) throw error;
}

async function markWorkspaceFree(workspaceId: string) {
  const admin = createAdminClient();
  const retentionDeadline = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { error } = await admin
    .from("workspaces")
    .update({
      plan: "free" satisfies WorkspacePlan,
      subscription_status: "canceled" satisfies SubscriptionStatus,
      cancel_at_period_end: false,
      data_retention_deadline: retentionDeadline,
    })
    .eq("id", workspaceId);
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = stripe().webhooks.constructEvent(
      rawBody,
      sig,
      requireEnv("STRIPE_WEBHOOK_SECRET")
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid";
    return NextResponse.json(
      { error: `signature verification failed: ${msg}` },
      { status: 400 });
  }

  const workspaceId = getWorkspaceIdFromEvent(event);
  const isNew = await recordEvent(event, workspaceId);
  if (!isNew) {
    // Already handled. Return 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const wsId = session.metadata?.workspace_id;
        if (!wsId) {
          console.error(
            "checkout.session.completed without workspace_id metadata",
            { sessionId: session.id }
          );
          break;
        }
        if (session.customer && typeof session.customer === "string") {
          const admin = createAdminClient();
          await admin
            .from("workspaces")
            .update({ stripe_customer_id: session.customer })
            .eq("id", wsId);
        }
        if (session.subscription && typeof session.subscription === "string") {
          const sub = await stripe().subscriptions.retrieve(session.subscription);
          await applySubscriptionToWorkspace(wsId, sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const wsId = sub.metadata?.workspace_id ?? workspaceId;
        if (!wsId) {
          console.error(
            `${event.type} without workspace_id metadata`,
            { subscriptionId: sub.id }
          );
          break;
        }
        await applySubscriptionToWorkspace(wsId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const wsId = sub.metadata?.workspace_id ?? workspaceId;
        if (!wsId) break;
        await markWorkspaceFree(wsId);
        break;
      }

      case "invoice.payment_failed":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscriptionId(invoice);
        if (!subId) break;
        const sub = await stripe().subscriptions.retrieve(subId);
        const wsId = sub.metadata?.workspace_id ?? workspaceId;
        if (!wsId) break;
        await applySubscriptionToWorkspace(wsId, sub);
        // Email notifications on payment_failed are a follow-up PR.
        break;
      }

      default:
        // Unhandled events are fine — we record them for audit and no-op.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("stripe webhook handler failed", { eventType: event.type, err });
    // Return 500 so Stripe retries. The dedupe in recordEvent already
    // happened; on retry, the second attempt will find the event in
    // billing_events and short-circuit. To handle the retry correctly,
    // we should delete the billing_events row when the handler fails.
    const admin = createAdminClient();
    await admin.from("billing_events").delete().eq("stripe_event_id", event.id);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
