import type React from "react";

export function Panel({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{description}</p>
      </div>
      {children}
      {footer ? <div>{footer}</div> : null}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--muted)] mb-1">{label}</div>
      {children}
    </label>
  );
}
