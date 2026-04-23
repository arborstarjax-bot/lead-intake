import { createPrivateKey, sign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

/**
 * Apple Push Notification service transport — ES256-signed JWT over HTTP/2
 * to api.push.apple.com. Zero runtime dependencies; the JWT + transport are
 * built on node:crypto + node:http2 (the APNs protocol has no REST fallback,
 * HTTP/2 is required).
 *
 * Parallel to src/lib/push.ts (web push via VAPID + web-push). Together they
 * make up the two delivery paths fanned out from sendNewLeadPush.
 *
 * Config env (all required before any APNs call is attempted):
 *   APNS_AUTH_KEY_P8   full PEM contents of the .p8 downloaded from
 *                      Apple Developer → Keys (ES256 private key).
 *   APNS_KEY_ID        10-char kid that identifies which .p8 in the team.
 *   APNS_TEAM_ID       10-char Apple Developer team / iss claim.
 *   APNS_BUNDLE_ID     App bundle id, used as the apns-topic header.
 *   APNS_USE_SANDBOX   optional; "1" to target api.sandbox.push.apple.com
 *                      (local Xcode dev-signed builds only — TestFlight
 *                      + App Store both use the production endpoint).
 */

// ---------------------------------------------------------------------------
// Config snapshot
// ---------------------------------------------------------------------------

type ApnsConfig = {
  keyPem: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
};

let cachedConfig: ApnsConfig | null | undefined = undefined;

function loadConfig(): ApnsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const keyPem = process.env.APNS_AUTH_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!keyPem || !keyId || !teamId || !bundleId) {
    cachedConfig = null;
    return null;
  }
  const host =
    process.env.APNS_USE_SANDBOX === "1"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";
  cachedConfig = { keyPem, keyId, teamId, bundleId, host };
  return cachedConfig;
}

export function isApnsConfigured(): boolean {
  return loadConfig() !== null;
}

// ---------------------------------------------------------------------------
// JWT (ES256) — cached for ~50 minutes.
//
// Apple mandates re-signing at least every 60 minutes and rate-limits tokens
// regenerated more often than once per 20 minutes. We sign once and reuse
// for 50 minutes; past that, next send triggers a fresh token.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function getJwt(cfg: ApnsConfig): string {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })
  );
  const payload = b64url(
    JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) })
  );
  const toSign = `${header}.${payload}`;
  const key = createPrivateKey({ key: cfg.keyPem, format: "pem" });
  // `ieee-p1363` emits the raw 64-byte r||s concat that JWS requires;
  // the default DER (ASN.1) encoding would fail APNs validation.
  const signature = sign("sha256", Buffer.from(toSign), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${toSign}.${b64url(signature)}`;
  cachedToken = { token, expiresAt: now + TOKEN_TTL_MS };
  return token;
}

/**
 * Invalidate the cached JWT. Exposed for tests and for 403
 * InvalidProviderToken recovery (e.g. after a key rotation in
 * Apple Developer the next call should force a resign).
 */
export function _resetApnsTokenForTests(): void {
  cachedToken = null;
  cachedConfig = undefined;
}

// ---------------------------------------------------------------------------
// HTTP/2 session — pooled per-process.
//
// APNs expects the same session to multiplex many device tokens. A fresh
// session per send is both slower and gets rate-limited. The session is
// torn down on error and lazily recreated on next send.
// ---------------------------------------------------------------------------

let session: ClientHttp2Session | null = null;

function getSession(cfg: ApnsConfig): ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  const s = connect(`https://${cfg.host}`);
  s.on("error", () => {
    if (session === s) session = null;
  });
  s.on("close", () => {
    if (session === s) session = null;
  });
  session = s;
  return s;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type ApnsSendInput = {
  deviceToken: string;
  title: string;
  body: string;
  /** Value for the `badge` aps field. */
  badge?: number;
  /** Clicks on grouped notifications collapse to the same thread. */
  collapseId?: string;
};

export type ApnsSendResult =
  | { ok: true }
  | {
      ok: false;
      /** HTTP :status header from APNs. -1 when the request never completed. */
      status: number;
      /** Apple's `reason` field from the response body (e.g. BadDeviceToken). */
      reason: string;
      /**
       * True when the token should be pruned from push_subscriptions:
       * 410 (unregistered) or specific 400 reasons (BadDeviceToken,
       * DeviceTokenNotForTopic, MissingDeviceToken).
       */
      shouldPrune: boolean;
    };

const PRUNEABLE_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "MissingDeviceToken",
  "Unregistered",
  "TopicDisallowed",
]);

export async function sendApnsPush(
  input: ApnsSendInput
): Promise<ApnsSendResult> {
  const cfg = loadConfig();
  if (!cfg) {
    return { ok: false, status: -1, reason: "NotConfigured", shouldPrune: false };
  }

  const payload = JSON.stringify({
    aps: {
      alert: { title: input.title, body: input.body },
      sound: "default",
      ...(typeof input.badge === "number" ? { badge: input.badge } : {}),
    },
  });

  const headers: Record<string, string> = {
    ":method": "POST",
    ":path": `/3/device/${input.deviceToken}`,
    authorization: `bearer ${getJwt(cfg)}`,
    "apns-topic": cfg.bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  };
  if (input.collapseId) headers["apns-collapse-id"] = input.collapseId;

  return new Promise<ApnsSendResult>((resolve) => {
    const s = getSession(cfg);
    const req = s.request(headers);
    let status = -1;
    let responseBody = "";
    req.setEncoding("utf8");
    req.on("response", (h) => {
      const raw = h[":status"];
      if (typeof raw === "number") status = raw;
      else if (typeof raw === "string") status = parseInt(raw, 10);
    });
    req.on("data", (chunk: string) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      if (status === 200) return resolve({ ok: true });
      let reason = "Unknown";
      try {
        const parsed = JSON.parse(responseBody);
        if (typeof parsed?.reason === "string") reason = parsed.reason;
      } catch {
        // Leave reason as "Unknown" — APNs is supposed to return JSON but
        // at the :status layer we still have useful info.
      }
      // 403 InvalidProviderToken: most common recovery is resigning. Reset
      // the cached JWT so the next caller gets a fresh one.
      if (status === 403 && reason === "InvalidProviderToken") {
        cachedToken = null;
      }
      const shouldPrune = status === 410 || PRUNEABLE_REASONS.has(reason);
      resolve({ ok: false, status, reason, shouldPrune });
    });
    req.on("error", () => {
      // Tear down the session so the next send reconnects.
      if (session) {
        try {
          session.close();
        } catch {
          // session.close throws if already closing — swallow.
        }
        session = null;
      }
      resolve({
        ok: false,
        status: -1,
        reason: "TransportError",
        shouldPrune: false,
      });
    });
    req.end(payload);
  });
}
