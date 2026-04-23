import type { Lead } from "@/modules/leads/model";
import { normalizeEmail, normalizePhone } from "@/modules/shared/format";

export type DuplicateMatch = {
  lead: Pick<Lead, "id" | "first_name" | "last_name" | "phone_number" | "email" | "address" | "status">;
  reason: "phone" | "email" | "address" | "name";
};

/**
 * Find possible duplicates for a candidate lead among existing leads.
 * - Phone and email matches are treated as HARD duplicates; address and
 *   name collisions are soft warnings. Callers decide how to surface each.
 */
export function findDuplicates(
  candidate: Partial<Lead>,
  existing: Pick<
    Lead,
    "id" | "first_name" | "last_name" | "phone_number" | "email" | "address" | "status"
  >[]
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const phone = normalizePhone(candidate.phone_number);
  const email = normalizeEmail(candidate.email);
  const addr = candidate.address?.trim().toLowerCase() || "";
  const name = [candidate.first_name, candidate.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();

  for (const row of existing) {
    if (row.status === "Completed") continue;
    if (phone && normalizePhone(row.phone_number) === phone) {
      matches.push({ lead: row, reason: "phone" });
      continue;
    }
    if (email && normalizeEmail(row.email) === email) {
      matches.push({ lead: row, reason: "email" });
      continue;
    }
    if (addr && (row.address || "").trim().toLowerCase() === addr) {
      matches.push({ lead: row, reason: "address" });
      continue;
    }
    const rowName = [row.first_name, row.last_name]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    if (name && rowName && name === rowName) {
      matches.push({ lead: row, reason: "name" });
    }
  }

  return matches;
}

/**
 * A lead is "saveable" when it has enough identity information to be useful:
 * at least one of phone number or email must be present and valid.
 */
export function isSaveable(lead: Partial<Lead>): boolean {
  const phone = normalizePhone(lead.phone_number);
  const email = normalizeEmail(lead.email);
  return Boolean(phone || email);
}
