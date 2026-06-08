import type { LeadStatus } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

/** Display options in the status dropdown. These map to DB statuses with
 *  smart routing — e.g. "Sold" = status:Completed + outcome_badge:Sold. */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "New", label: "New" },
  { value: "Called / No Response", label: "Needs Follow-Up" },
  { value: "Scheduled", label: "Scheduled" },
  { value: "Pending", label: "Pending" },
  { value: "Sold", label: "Sold" },
  { value: "Not Sold", label: "Not Sold" },
  { value: "Lost", label: "Lost" },
];

export type StatusTransition =
  | { kind: "simple"; status: LeadStatus }
  | { kind: "sold" }
  | { kind: "not_sold" }
  | { kind: "lost" }
  | { kind: "needs_follow_up" }
  | { kind: "completed" };

const STYLE_MAP: Record<string, { bg: string; fg: string; dot: string }> = {
  New: { bg: "bg-[var(--status-new-bg)]", fg: "text-[var(--status-new-fg)]", dot: "#2563eb" },
  "Called / No Response": {
    bg: "bg-[var(--status-called-bg)]",
    fg: "text-[var(--status-called-fg)]",
    dot: "#d97706",
  },
  Scheduled: {
    bg: "bg-[var(--status-scheduled-bg)]",
    fg: "text-[var(--status-scheduled-fg)]",
    dot: "#4f9d25",
  },
  Pending: {
    bg: "bg-purple-50",
    fg: "text-purple-700",
    dot: "#7c3aed",
  },
  Completed: {
    bg: "bg-[var(--status-completed-bg)]",
    fg: "text-[var(--status-completed-fg)]",
    dot: "#0f3d26",
  },
  Lost: {
    bg: "bg-slate-100",
    fg: "text-slate-600",
    dot: "#64748b",
  },
};

function resolveStyle(status: LeadStatus, outcomeBadge?: string | null) {
  if (status === "Completed" && outcomeBadge === "Sold") {
    return { bg: "bg-green-50", fg: "text-green-700", dot: "#16a34a" };
  }
  if (status === "Completed" && outcomeBadge === "Not Sold") {
    return { bg: "bg-rose-50", fg: "text-rose-700", dot: "#e11d48" };
  }
  return STYLE_MAP[status] ?? STYLE_MAP.New;
}

function resolveLostLabel(followUpResult?: string | null): string {
  if (!followUpResult) return "Lost";
  return `Lost (${followUpResult})`;
}

function resolveNotSoldLabel(followUpResult?: string | null): string {
  if (!followUpResult) return "Not Sold";
  return `Not Sold (${followUpResult})`;
}

function resolveDisplayValue(status: LeadStatus, outcomeBadge?: string | null): string {
  if (status === "Completed" && outcomeBadge === "Sold") return "Sold";
  if (status === "Completed" && outcomeBadge === "Not Sold") return "Not Sold";
  if (status === "Completed") return "Sold"; // fallback for completed without badge
  return status;
}

function resolveFullDisplayLabel(status: LeadStatus, outcomeBadge?: string | null, followUpResult?: string | null): string {
  if (status === "Lost") return resolveLostLabel(followUpResult);
  if (status === "Completed" && outcomeBadge === "Not Sold") return resolveNotSoldLabel(followUpResult);
  return resolveDisplayValue(status, outcomeBadge);
}

export function StatusPill({
  status,
  outcomeBadge,
  followUpResult,
  onChange,
}: {
  status: LeadStatus;
  outcomeBadge?: string | null;
  followUpResult?: string | null;
  onChange: (transition: StatusTransition) => void;
}) {
  const style = resolveStyle(status, outcomeBadge);
  const displayValue = resolveDisplayValue(status, outcomeBadge);
  const fullLabel = resolveFullDisplayLabel(status, outcomeBadge, followUpResult);

  function handleChange(value: string) {
    switch (value) {
      case "Sold":
        onChange({ kind: "sold" });
        break;
      case "Not Sold":
        onChange({ kind: "not_sold" });
        break;
      case "Lost":
        onChange({ kind: "lost" });
        break;
      case "Pending":
        onChange({ kind: "simple", status: "Pending" as LeadStatus });
        break;
      case "Called / No Response":
        onChange({ kind: "needs_follow_up" });
        break;
      default:
        onChange({ kind: "simple", status: value as LeadStatus });
    }
  }

  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-full px-3 h-9 text-sm font-medium",
        style.bg,
        style.fg
      )}
    >
      <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: style.dot }} />
      {fullLabel !== displayValue && (
        <span className="mr-1 text-xs truncate max-w-[10rem]">{fullLabel}</span>
      )}
      <select
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(
          "appearance-none bg-transparent pr-6 focus:outline-none",
          style.fg
        )}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs",
          style.fg
        )}
      >
        ▾
      </span>
    </div>
  );
}
