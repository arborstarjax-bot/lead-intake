import webpush from "web-push";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { isApnsConfigured, sendApnsPush } from "@/lib/apns";

type WebPushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_acknowledged_at: string;
};

type NativePushRow = {
  id: string;
  device_token: string;
  platform: "ios" | "android";
  last_acknowledged_at: string;
};

let configured = false;
function configure() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:arborstarjax@gmail.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type NewLeadPushInput = {
  /** Workspace whose members should be notified. */
  workspaceId: string;
  /** Most recent lead summary (shown in the body if only one is unseen). */
  latestLead: { client: string | null; phone_number: string | null } | null;
  /** Deep-link target for the notification tap. */
  url?: string;
};

/**
 * Fan out a "new lead" push to every stored subscription in this workspace,
 * across both the web and native (APNs) delivery paths.
 *
 * Each subscription gets its own payload because the badge count / title
 * depend on how many leads arrived since that device last opened the app.
 * Dead subscriptions (410/404 on web, 410 or BadDeviceToken on APNs) are
 * pruned so the table stays clean.
 *
 * Silently no-ops if neither delivery path is configured — push is optional.
 */
export async function sendNewLeadPush(input: NewLeadPushInput): Promise<void> {
  const webEnabled = configure();
  const apnsEnabled = isApnsConfigured();
  if (!webEnabled && !apnsEnabled) return;

  await Promise.all([
    webEnabled ? sendWeb(input) : Promise.resolve(),
    apnsEnabled ? sendNative(input) : Promise.resolve(),
  ]);
}

async function sendWeb(input: NewLeadPushInput): Promise<void> {
  const admin = createAdminClient();
  // platform='web' only: native (ios/android) rows carry a device_token
  // instead of an endpoint and are delivered by APNs / FCM, not web-push.
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, last_acknowledged_at")
    .eq("workspace_id", input.workspaceId)
    .eq("platform", "web");
  if (!subs || subs.length === 0) return;

  await Promise.all(
    (subs as WebPushRow[]).map(async (s) => {
      const unseen = await countUnseen(
        input.workspaceId,
        s.last_acknowledged_at
      );
      const { title, body } = renderNewLeadPayload(unseen, input.latestLead);
      const payload = JSON.stringify({
        title,
        body,
        url: input.url ?? "/leads",
        badgeCount: unseen,
        tag: "new-lead",
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        );
        await admin
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq("id", s.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          await admin
            .from("push_subscriptions")
            .update({ last_error: (err as Error).message })
            .eq("id", s.id);
        }
      }
    })
  );
}

async function sendNative(input: NewLeadPushInput): Promise<void> {
  const admin = createAdminClient();
  // APNs only for now — Android (FCM) will route through the same table
  // with platform='android' when its transport lands.
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, device_token, platform, last_acknowledged_at")
    .eq("workspace_id", input.workspaceId)
    .eq("platform", "ios");
  if (!subs || subs.length === 0) return;

  await Promise.all(
    (subs as NativePushRow[]).map(async (s) => {
      const unseen = await countUnseen(
        input.workspaceId,
        s.last_acknowledged_at
      );
      const { title, body } = renderNewLeadPayload(unseen, input.latestLead);
      const result = await sendApnsPush({
        deviceToken: s.device_token,
        title,
        body,
        badge: unseen,
        collapseId: "new-lead",
      });
      if (result.ok) {
        await admin
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq("id", s.id);
        return;
      }
      if (result.shouldPrune) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        return;
      }
      await admin
        .from("push_subscriptions")
        .update({ last_error: `${result.status} ${result.reason}` })
        .eq("id", s.id);
    })
  );
}

async function countUnseen(
  workspaceId: string,
  since: string
): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gt("created_at", since);
  return count ?? 1;
}

function renderNewLeadPayload(
  unseen: number,
  latestLead: NewLeadPushInput["latestLead"]
): { title: string; body: string } {
  const title = unseen === 1 ? "New lead" : `${unseen} new leads`;
  const body =
    unseen === 1 && latestLead
      ? [latestLead.client, latestLead.phone_number]
          .filter(Boolean)
          .join(" · ") || "Tap to review."
      : "Tap to review.";
  return { title, body };
}

/**
 * Mark a subscription as "caught up as of now" so its future badge counts
 * restart from zero. Scoped to the caller's user_id so a user can't mark
 * someone else's device caught-up.
 */
export async function acknowledgeSubscription(
  userId: string,
  opts: { endpoint?: string; device_token?: string }
): Promise<void> {
  const admin = createAdminClient();
  if (opts.endpoint) {
    await admin
      .from("push_subscriptions")
      .update({ last_acknowledged_at: new Date().toISOString() })
      .eq("endpoint", opts.endpoint)
      .eq("user_id", userId);
    return;
  }
  if (opts.device_token) {
    await admin
      .from("push_subscriptions")
      .update({ last_acknowledged_at: new Date().toISOString() })
      .eq("device_token", opts.device_token)
      .eq("user_id", userId);
  }
}
