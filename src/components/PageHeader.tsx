import Link from "next/link";
import { Settings as SettingsIcon, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/**
 * Shared app header. Renders the LeadFlow mark, an optional page title,
 * and the Workspace + Settings icons so primary navigation chrome is
 * consistent across every page.
 *
 * Pages that need to surface their own status affordance (unsaved-changes
 * state on Settings, user email on Billing/Workspace, etc.) can pass a
 * `rightSlot` — it renders ABOVE the persistent icon cluster at narrow
 * widths and beside the icons at sm+ so both always fit. Icons stay no
 * matter what so users never lose access to workspace switching or
 * settings.
 */
export function PageHeader({
  title,
  rightSlot,
  /** Hide the Workspace + Settings icon cluster. Use ONLY on pages where
   *  those icons would be confusing (e.g. the unauthenticated orphan
   *  workspace view before membership is established). Rarely needed. */
  hideNavIcons = false,
}: {
  title?: string;
  rightSlot?: ReactNode;
  hideNavIcons?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link href="/" aria-label="Home" className="inline-flex items-center">
        <Logo variant="mark" size="sm" />
      </Link>
      {title ? (
        <h1 className="text-lg sm:text-xl font-semibold truncate">{title}</h1>
      ) : (
        <div aria-hidden className="w-9" />
      )}
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        {rightSlot ? (
          <span className="inline-flex items-center">{rightSlot}</span>
        ) : null}
        {!hideNavIcons && (
          <>
            <Link
              href="/workspace"
              aria-label="Workspace"
              className="inline-flex items-center justify-center h-11 w-11 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <Users className="h-4 w-4" />
            </Link>
            <Link
              href="/settings"
              aria-label="Settings"
              className="inline-flex items-center justify-center h-11 w-11 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
