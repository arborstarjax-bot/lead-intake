import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, inferPlanFromSubscription } from "@/lib/stripe";
import { createAdminClient } from "@/modules/shared/supabase/server";
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
 * Idempotently record the event and decide whether to process it.
 *
 * - "new": first time we've seen this event. Process it, then mark
 *   processed_at on success.
 * - "retry": we saw this event before but the handler errored
 *   (processed_at is still null). Stripe's re-delivery should re-run
 *   the handler.
 * - "already": processed_at is set — handler previously succeeded.
 *   Caller short-circuits and returns 200.
 *
 * Rows are never deleted, so a failed cleanup can't silently swallow
 * an event. This replaces the previous "delete on error" pattern.
 */
async function recordEvent(
  event: Stripe.Event,
  workspaceId: string | null
): Promise<"new" | "retry" | "already"> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    workspace_id: workspaceId,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!error) return "new";
  // Unique violation on stripe_event_id — we've seen this event before.
  if (error.code !== "23505") throw error;
  const { data: existing } = await admin
    .from("billing_events")
    .select("processed_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  return existing?.processed_at ? "already" : "retry";
}

async function markEventProcessed(event: Stripe.Event) {
  const admin = createAdminClient();
  // Supabase's .update() returns { error }, it does not throw. If the
  // update fails (DB blip), processed_at stays null — on the next Stripe
  // re-delivery the disposition would then flip back to "retry" and the
  // handler would run again, which is the opposite of idempotent. Throw
  // here so the POST handler's catch returns 500, Stripe retries, and
  // eventually the update lands.
  const { error } = await admin
    .from("billing_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", event.id);
  if (error) throw error;
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
  const disposition = await recordEvent(event, workspaceId);
  if (disposition === "already") {
    // Already handled. Return 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true });
  }
  // disposition === "new" or "retry": fall through to the handler. A
  // retry means an earlier attempt errored before marking
  // processed_at; the handler itself must be idempotent (all of our
  // subscription writes are last-write-wins on state).
  void disposition;

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
        const embedded = event.data.object as Stripe.Subscription;
        const wsId = embedded.metadata?.workspace_id ?? workspaceId;
        if (!wsId) {
          console.error(
            `${event.type} without workspace_id metadata`,
            { subscriptionId: embedded.id }
          );
          break;
        }
        // Retrieve the live subscription instead of trusting the event's
        // embedded snapshot. Stripe doesn't guarantee webhook delivery
        // order — an older `updated` arriving after a newer one would
        // otherwise clobber current state with stale data. A fresh
        // retrieve always returns the authoritative current state.
        const sub = await stripe().subscriptions.retrieve(embedded.id);
        await applySubscriptionToWorkspace(wsId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        // A subscription deletion is terminal — Stripe will not resurrect
        // it. Out-of-order delivery concerns don't apply here: if a later
        // `subscription.updated` for the same sub arrives with status=
        // "active" (e.g. the customer resubscribed), its handler above
        // retrieves the current live subscription and overwrites free
        // back to the paid plan, which is the correct outcome.
        const embedded = event.data.object as Stripe.Subscription;
        const wsId = embedded.metadata?.workspace_id ?? workspaceId;
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

    await markEventProcessed(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("stripe webhook handler failed", { eventType: event.type, err });
    // Return 500 so Stripe retries. The billing_events row is left in
    // place with processed_at=null — the next retry will see
    // disposition="retry" and re-run the handler. This is safer than
    // the old "delete on error" flow, which could silently swallow an
    // event forever if the cleanup DELETE itself failed.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
