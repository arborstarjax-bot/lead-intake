import { cn } from "@/lib/utils";

export function DefaultSalespersonPicker({
  roster,
  value,
  onChange,
}: {
  roster: string[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  if (roster.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Add a salesperson above first, then pick one as the default.
      </p>
    );
  }
  const current = value?.trim() ?? "";
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "h-9 px-3 rounded-full text-sm font-medium transition-colors",
          current === ""
            ? "bg-[var(--accent)] text-white"
            : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
        )}
      >
        None
      </button>
      {roster.map((name) => {
        const active = name.toLowerCase() === current.toLowerCase();
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(active ? null : name)}
            className={cn(
              "h-9 px-3 rounded-full text-sm font-medium transition-colors",
              active
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--fg)] hover:bg-slate-200"
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
