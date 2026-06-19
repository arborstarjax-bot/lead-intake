"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CheckSquare, Home, List } from "lucide-react";

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
    href: "/route",
    label: "Schedule",
    Icon: CalendarDays,
    match: (p) => p.startsWith("/route") || p.startsWith("/calendar"),
  },
  {
    href: "/tasks",
    label: "Tasks",
    Icon: CheckSquare,
    match: (p) => p.startsWith("/tasks"),
  },
];

// Pages where the chrome shouldn't appear: auth and endpoint-style URLs
// where a persistent nav would be out of place. Legal pages (privacy /
// terms) keep the nav so the tab bar stays consistent across the app.
const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/u/"];

/**
 * Mobile-only bottom tab bar. Uses `fixed` positioning so it is always
 * anchored to the bottom of the viewport regardless of scroll position,
 * keyboard open/close, or iOS Safari dynamic toolbar resizing. The
 * layout's `<main>` wrapper adds matching bottom padding so page content
 * is never hidden behind this bar.
 *
 * Respects the iOS home indicator via `env(safe-area-inset-bottom)`.
 * Hidden on auth pages and on `md` breakpoints and above (where desktop
 * nav in each page header provides the equivalent entry points).
 */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-white"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        WebkitTransform: "translateZ(0)",
        transform: "translateZ(0)",
      }}
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
