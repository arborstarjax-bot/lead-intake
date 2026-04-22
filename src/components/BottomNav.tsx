"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, List, MapPin } from "lucide-react";

type Tab = {
  href: string;
  label: string;
  Icon: typeof Home;
  match: (pathname: string) => boolean;
};

const tabs: Tab[] = [
  {
    href: "/",
    label: "Home",
    Icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/leads",
    label: "Leads",
    Icon: List,
    match: (p) => p.startsWith("/leads"),
  },
  {
    href: "/calendar",
    label: "Calendar",
    Icon: CalendarDays,
    match: (p) => p.startsWith("/calendar"),
  },
  {
    href: "/route",
    label: "Route",
    Icon: MapPin,
    match: (p) => p.startsWith("/route"),
  },
];

// Pages where the chrome shouldn't appear: auth and endpoint-style URLs
// where a persistent nav would be out of place. Legal pages (privacy /
// terms) keep the nav so the tab bar stays consistent across the app.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/u/"];

/**
 * Mobile-only bottom tab bar. Renders a fixed 5-tab strip anchored to the
 * bottom of the viewport, respecting the iOS home indicator via
 * `env(safe-area-inset-bottom)`. Hidden on auth / legal pages and on
 * `md` breakpoints and above (where desktop nav in each page header
 * provides the equivalent entry points).
 */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                  active
                    ? "text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
