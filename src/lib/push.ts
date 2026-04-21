import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";

type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  badgeCount?: number;
  tag?: string;
};

/**
 * Fan out a Web Push notification to every stored subscription.
 * Dead subscriptions (410/404) are removed so the table stays clean.
 * Silently no-ops if VAPID keys are not configured — push is optional.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!configure()) return;
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (!subs || subs.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    (subs as PushRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body
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

/** Count of unread-ish leads for iOS app-icon badge. */
export async function currentBadgeCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .neq("status", "Completed");
  return count ?? 0;
}
