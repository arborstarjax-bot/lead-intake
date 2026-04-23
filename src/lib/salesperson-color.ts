/**
 * Deterministic color assignment for salespeople.
 *
 * `sales_person` is a free-text display name (not an FK to a user row),
 * so we can't look up a persisted color — we derive one from a hash of
 * the name. Same name → same color across reloads, different days, and
 * different team members' browsers.
 *
 * Palette is chosen for:
 *   • high contrast on a white background,
 *   • distinguishable when desaturated (colorblind-safe-ish),
 *   • works for both solid fills (timed event blocks, dark text) and
 *     soft fills (flex chips, legend dots).
 *
 * `null` / empty salesperson uses a neutral gray so unassigned leads
 * stay visible but don't compete with real people in the legend.
 */

export type SalespersonColor = {
  /** Solid fill for timed event blocks. White text on top. */
  solid: string;
  /** Soft fill for flex chips + legend dots. Dark text on top. */
  soft: string;
  /** Dark text color for use on `soft` backgrounds. */
  fg: string;
  /** Solid dot for the legend swatch. */
  dot: string;
};

// Paired hex values so Tailwind's JIT isn't involved — each caller
// reads these via inline `style`.
const PALETTE: SalespersonColor[] = [
  { solid: "#0ea5e9", soft: "#e0f2fe", fg: "#075985", dot: "#0ea5e9" }, // sky
  { solid: "#16a34a", soft: "#dcfce7", fg: "#166534", dot: "#16a34a" }, // green
  { solid: "#d97706", soft: "#fef3c7", fg: "#92400e", dot: "#d97706" }, // amber
  { solid: "#db2777", soft: "#fce7f3", fg: "#9d174d", dot: "#db2777" }, // pink
  { solid: "#7c3aed", soft: "#ede9fe", fg: "#5b21b6", dot: "#7c3aed" }, // violet
  { solid: "#0891b2", soft: "#cffafe", fg: "#155e75", dot: "#0891b2" }, // cyan
  { solid: "#ea580c", soft: "#ffedd5", fg: "#9a3412", dot: "#ea580c" }, // orange
  { solid: "#9333ea", soft: "#f3e8ff", fg: "#6b21a8", dot: "#9333ea" }, // purple
];

const UNASSIGNED: SalespersonColor = {
  solid: "#64748b",
  soft: "#f1f5f9",
  fg: "#334155",
  dot: "#64748b",
};

/** FNV-1a 32-bit. Tiny, fast, zero-dependency, good enough for bucketing. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/** Normalize to a stable cache key. Trimmed, lowercased, collapsed spaces. */
export function normalizeSalespersonKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Returns the color bundle for a given salesperson name. Stable:
 * the same name always maps to the same palette entry.
 */
export function salespersonColor(raw: string | null | undefined): SalespersonColor {
  const key = normalizeSalespersonKey(raw);
  if (!key) return UNASSIGNED;
  const idx = hashString(key) % PALETTE.length;
  return PALETTE[idx];
}

/** Label used in the filter dropdown + legend for unassigned leads. */
export const UNASSIGNED_LABEL = "Unassigned";
