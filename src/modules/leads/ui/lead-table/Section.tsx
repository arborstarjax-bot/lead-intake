import type React from "react";

export function Section({
  label,
  icon,
  children,
}: {
  label?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 pt-3 pb-1">
      {label && (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {icon}
          <span>{label}</span>
        </div>
      )}
      {children}
    </section>
  );
}
