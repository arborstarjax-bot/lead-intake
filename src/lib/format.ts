/**
 * Parse and normalize a US phone number to E.164-ish `+1XXXXXXXXXX`.
 * Accepts common formats: "(904) 555-1212", "904.555.1212", "+1 904 555 1212".
 * Returns null if fewer than 10 digits remain.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

/** Format a normalized phone for display. */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = p.replace(/\D+/g, "");
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  if (last10.length !== 10) return p;
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
}

/** Lowercase and strip-whitespace email normalization. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/** Normalize a US state (or DC) to 2-letter abbreviation. */
const STATE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
  // DC isn't a state but USPS treats it like one and addresses inside
  // the beltway frequently read "Washington, DC" — previously these
  // returned null and the address would drop state entirely.
  "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC",
  "washington, dc": "DC", "washington, d.c.": "DC",
};

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  // D.C. with periods — strip them so "D.C." and "DC" both resolve.
  const compact = v.replace(/\./g, "").toLowerCase();
  if (compact === "dc") return "DC";
  return STATE_MAP[v.toLowerCase()] ?? STATE_MAP[compact] ?? null;
}

/** Normalize a 5- or 9-digit US zip. */
export function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{5})(-?\d{4})?/);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2].replace("-", "")}` : m[1];
}

/** Display name derived from first + last, or best fallback. */
export function displayName(first?: string | null, last?: string | null): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f && l) return `${f} ${l}`;
  return f || l || "";
}

/** Calendar event title per spec: "First Last - Zip" with graceful fallback. */
export function calendarEventTitle(args: {
  first_name?: string | null;
  last_name?: string | null;
  zip?: string | null;
  phone_number?: string | null;
  email?: string | null;
}): string {
  const name =
    displayName(args.first_name, args.last_name) ||
    args.phone_number ||
    args.email ||
    "Estimate";
  return args.zip ? `${name} - ${args.zip}` : name;
}
