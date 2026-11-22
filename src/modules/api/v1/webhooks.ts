import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";
import type { WebhookEvent } from "./contracts";

/**
 * Webhook dispatch for /api/v1 events.
 *
 * emitWebhookEvent() is called from write paths (leads/tasks routes,
 * intake). It fans the event out to every active subscription matching
 * the event type, inserts webhook_deliveries rows, then delivers each
 * one fire-and-forget — the caller's response never waits on a remote
 * endpoint.
 *
 * Retries: each attempt schedules next_retry_at with exponential
 * backoff (1m, 5m, 25m — ~30 min total). processRetries() is invoked
 * lazily from v1 read routes; a cron can call the same function later.
 */

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [60_000, 300_000, 1_500_000];

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function emitWebhookEvent(
  workspaceId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("webhook_subscriptions")
      .select("id, url, secret")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .contains("events", [event]);
    if (!subs?.length) return;

    const body = JSON.stringify({
      id: crypto.randomUUID(),
      type: event,
      createdAt: new Date().toISOString(),
      data,
    });

    for (const sub of subs) {
      const { data: delivery } = await admin
        .from("webhook_deliveries")
        .insert({
          subscription_id: sub.id,
          workspace_id: workspaceId,
          event,
          payload: { body },
        })
        .select("id")
        .single();
      if (!delivery) continue;
      // Fire and forget — never block the caller's response on a remote
      // endpoint. Failures are retried via processRetries().
      void deliver(delivery.id, sub.url, sub.secret, body);
    }
  } catch {
    // Webhook fan-out must never break the write that triggered it.
  }
}

async function deliver(
  deliveryId: string,
  url: string,
  secret: string,
  body: string
): Promise<void> {
  const admin = createAdminClient();
  const attempt = (await admin
    .from("webhook_deliveries")
    .select("attempts")
    .eq("id", deliveryId)
    .single()).data?.attempts ?? 0;

  let statusCode: number | null = null;
  let error: string | null = null;
  // Re-validate the target on every attempt: a subscription URL that
  // passed at create time can be re-pointed at a private address via
  // DNS rebinding. Blocked deliveries fail permanently (no retry).
  let blocked = false;
  try {
    await assertSafeOutboundUrl(url);
  } catch {
    blocked = true;
    error = "Blocked: target URL failed safety checks";
  }
  if (!blocked) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-leadflow-signature": sign(secret, body),
          "user-agent": "LeadFlow-Webhooks/1.0",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      // Store generic text — a raw error message leaks the target's
      // address/errno and turns deliveries into a probing oracle.
      const name = (e as Error).name;
      error = name === "TimeoutError" || name === "AbortError"
        ? "Request timed out"
        : "Request failed";
    }
  }

  const nextAttempt = attempt + 1;
  const failedPermanently = (blocked || statusCode === null || statusCode >= 400) && (blocked || nextAttempt >= MAX_ATTEMPTS);
  const succeeded = statusCode !== null && statusCode >= 200 && statusCode < 300;

  await admin
    .from("webhook_deliveries")
    .update({
      attempts: nextAttempt,
      status: succeeded ? "delivered" : failedPermanently ? "failed" : "pending",
      last_status_code: statusCode,
      last_error: error,
      next_retry_at:
        succeeded || failedPermanently
          ? null
          : new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(nextAttempt - 1, RETRY_BACKOFF_MS.length - 1)]).toISOString(),
    })
    .eq("id", deliveryId);
}

/** Drain due retries. Called lazily from v1 reads; O(pending) rows. */
export async function processRetries(): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: due } = await admin
      .from("webhook_deliveries")
      .select("id, payload, webhook_subscriptions!inner(url, secret)")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .limit(20);
    for (const d of due ?? []) {
      const sub = d.webhook_subscriptions as unknown as { url: string; secret: string };
      void deliver(d.id, sub.url, sub.secret, (d.payload as { body: string }).body);
    }
  } catch {
    // Best-effort.
  }
}
