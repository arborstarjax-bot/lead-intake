import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for server-initiated requests to member-supplied URLs
 * (webhook subscriptions, web-push endpoints).
 *
 * Rules enforced by assertSafeOutboundUrl():
 *   - https: scheme only (no http:, no credentials in the URL)
 *   - literal IP hosts may not be private/reserved
 *   - every address the hostname resolves to must be a public IP
 *
 * DNS is resolved inside this check, so callers MUST re-run it before
 * each outbound request (not just at save time) — a hostname passing at
 * subscribe time can be re-pointed at a private address later (DNS
 * rebinding).
 */

export class UnsafeOutboundUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeOutboundUrlError";
  }
}

/** Parse a WHATWG-canonical IPv4 string into octets. */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/** True when an IPv4 address is loopback/private/link-local/reserved. */
function isDisallowedIPv4(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

/** Expand an IPv6 string (incl. ::ffff:a.b.c.d) into 16 bytes, or null. */
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // Embedded IPv4 tail (mapped ::ffff:x.x.x.x, compatible ::x.x.x.x).
  if (s.includes(".")) {
    const idx = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    s = `${s.slice(0, idx)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (head.length + tail.length > 8) return null;
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function isDisallowedIPv6(bytes: number[]): boolean {
  const isZero = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);

  // :: (unspecified) and ::1 (loopback)
  if (isZero(0, 15) && bytes[15] === 0) return true;
  if (isZero(0, 15) && bytes[15] === 1) return true;
  // ::ffff:0:0/96 IPv4-mapped — evaluate the embedded IPv4.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isDisallowedIPv4(bytes.slice(12));
  }
  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64 — embedded IPv4 in last 32 bits.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isDisallowedIPv4(bytes.slice(12));
  }
  // 2002::/16 6to4 — embedded IPv4 in bits 16-48.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isDisallowedIPv4(bytes.slice(2, 6));
  }
  return (
    bytes[0] === 0xff || // ff00::/8 multicast
    (bytes[0] & 0xfe) === 0xfc || // fc00::/7 unique-local
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // fe80::/10 link-local
    (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) // 2001:db8::/32 docs
  );
}

/** True when a literal IP address is not a public unicast target. */
export function isDisallowedIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isDisallowedIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isDisallowedIPv6(v6);
  // Unparseable — treat as unsafe.
  return true;
}

/**
 * Validate an outbound URL and return it parsed. Throws
 * UnsafeOutboundUrlError on any failure. Resolves DNS — async.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError("invalid URL");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("only https: URLs are allowed");
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError("credentials in URLs are not allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new UnsafeOutboundUrlError("missing hostname");

  if (isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new UnsafeOutboundUrlError("hostname is not a public address");
    }
    return url;
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeOutboundUrlError("hostname does not resolve");
  }
  if (!addrs.length) throw new UnsafeOutboundUrlError("hostname does not resolve");
  for (const { address } of addrs) {
    if (isDisallowedIp(address)) {
      throw new UnsafeOutboundUrlError("hostname resolves to a non-public address");
    }
  }
  return url;
}

export async function isSafeOutboundUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeOutboundUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

// ── Web push endpoints ────────────────────────────────────────────────

/**
 * Host suffixes of the known web-push services. Browser PushSubscription
 * endpoints are always issued by one of these, so anything else can be
 * rejected outright at subscribe time — the tightest possible SSRF bound.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "wns.windows.com", // legacy WNS hosts seen in the wild
] as const;

export function isAllowedPushHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`)
  );
}

/**
 * Validate a stored/stored-candidate web-push endpoint: https, on the
 * known push-service allowlist, and resolving to public IPs. Async —
 * re-run before every send to defeat DNS rebinding.
 */
export async function assertPushEndpoint(rawUrl: string): Promise<URL> {
  const url = await assertSafeOutboundUrl(rawUrl);
  if (!isAllowedPushHost(url.hostname)) {
    throw new UnsafeOutboundUrlError("endpoint is not a known push service");
  }
  return url;
}

export async function isSafePushEndpoint(rawUrl: string): Promise<boolean> {
  try {
    await assertPushEndpoint(rawUrl);
    return true;
  } catch {
    return false;
  }
}
