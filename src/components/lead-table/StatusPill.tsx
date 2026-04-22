import type { LeadStatus } from "@/lib/types";
import { LEAD_STATUSES } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<LeadStatus, { bg: string; fg: string; dot: string }> = {
  New: { bg: "bg-[var(--status-new-bg)]", fg: "text-[var(--status-new-fg)]", dot: "#2563eb" },
  "Called / No Response": {
    bg: "bg-[var(--status-called-bg)]",
    fg: "text-[var(--status-called-fg)]",
    dot: "#d97706",
  },
  Scheduled: {
    bg: "bg-[var(--status-scheduled-bg)]",
    fg: "text-[var(--status-scheduled-fg)]",
    dot: "#43B02A",
  },
  Completed: {
    bg: "bg-[var(--status-completed-bg)]",
    fg: "text-[var(--status-completed-fg)]",
    dot: "#166534",
  },
  Lost: {
    bg: "bg-slate-100",
    fg: "text-slate-600",
    dot: "#64748b",
  },
};

export function StatusPill({
  status,
  onChange,
}: {
  status: LeadStatus;
  onChange: (next: LeadStatus) => void;
}) {
  const style = STATUS_STYLE[status];
  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-full px-3 h-9 text-sm font-medium",
        style.bg,
        style.fg
      )}
    >
      <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: style.dot }} />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as LeadStatus)}
        className={cn(
          "appearance-none bg-transparent pr-6 focus:outline-none",
          style.fg
        )}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
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
