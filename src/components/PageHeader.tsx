import Link from "next/link";
import { Settings as SettingsIcon, Users } from "lucide-react";
import { Logo } from "@/components/Logo";

/**
 * Shared app header. Renders the LeadFlow mark, an optional page title,
 * and the Workspace + Settings icons so primary navigation chrome is
 * consistent across every page. Use on standalone pages like /privacy and
 * /terms that otherwise have no header of their own.
 */
export function PageHeader({ title }: { title?: string }) {
  return (
    <header className="flex items-center justify-between gap-2">
      <Link href="/" aria-label="Home" className="inline-flex items-center">
        <Logo variant="mark" size="sm" />
      </Link>
      {title ? (
        <h1 className="text-lg sm:text-xl font-semibold truncate">{title}</h1>
      ) : (
        <div aria-hidden className="w-9" />
      )}
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        <Link
          href="/workspace"
          aria-label="Workspace"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <Users className="h-4 w-4" />
        </Link>
        <Link
          href="/settings"
          aria-label="Settings"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
