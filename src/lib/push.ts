import webpush from "web-push";
import { createAdminClient } from "@/modules/shared/supabase/server";

type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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
 * Fan out a "new lead" push to every stored subscription in this workspace.
 * Each subscription gets its own payload because the badge count / title
 * depend on how many leads arrived since that device last opened the app.
 * Dead subscriptions (410/404) are pruned so the table stays clean.
 *
 * Silently no-ops if VAPID keys are not configured — push is optional.
 */
export async function sendNewLeadPush(input: NewLeadPushInput): Promise<void> {
  if (!configure()) return;
  const admin = createAdminClient();
  // platform='web' only: native (ios/android) rows carry a device_token
  // instead of an endpoint and are delivered by APNs / FCM, not web-push.
  // They're picked up separately by sendNewLeadNativePush once the
  // native-send path ships (see docs/IOS_SHELL_SETUP.md §5d).
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, last_acknowledged_at")
    .eq("workspace_id", input.workspaceId)
    .eq("platform", "web");
  if (!subs || subs.length === 0) return;

  await Promise.all(
    (subs as PushRow[]).map(async (s) => {
      // How many leads has this device not yet seen (including the one
      // that just triggered this push) — scoped to the workspace.
      const { count } = await admin
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", input.workspaceId)
        .gt("created_at", s.last_acknowledged_at);
      const unseen = count ?? 1;

      const title = unseen === 1 ? "New lead" : `${unseen} new leads`;
      const body =
        unseen === 1 && input.latestLead
          ? [input.latestLead.client, input.latestLead.phone_number]
              .filter(Boolean)
              .join(" · ") || "Tap to review."
          : "Tap to review.";

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
