import type React from "react";
import { cn } from "@/lib/utils";

export function ActionIconLink({
  href,
  title,
  onClick,
  children,
}: {
  href: string | undefined;
  title: string;
  /** Optional side-effect fired on click AFTER the no-href guard. Runs
   *  even for disabled links (so callers can still react to taps), but
   *  we only fire navigation when `href` is set. */
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-disabled={!href}
      aria-label={title}
      title={title}
      onClick={(e) => {
        if (!href) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition",
        href
          ? "border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          : "border-[var(--border)] text-[var(--subtle)] opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </a>
  );
}
