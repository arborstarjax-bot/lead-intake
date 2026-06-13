"use client";

/**
 * Redirects new workspaces to the setup wizard until they've completed it.
 * Renders nothing — purely a navigation side-effect component.
 *
 * The guard fires only when:
 *   - The settings have loaded (non-default created_at)
 *   - `setup_completed` is explicitly false
 *   - The current path is not already `/setup`, `/login`, `/signup`, etc.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppSettings } from "./SettingsProvider";

const EXEMPT_PATHS = [
  "/setup",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/workspace",
  "/terms",
  "/api",
];

function isExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function SetupGuard() {
  const { settings } = useAppSettings();
  const pathname = usePathname();
  const router = useRouter();
  const redirected = useRef(false);

  // Reset the one-shot guard whenever settings change (e.g. after an
  // account switch the SettingsProvider pushes new settings). Without
  // this, the guard stays locked after the first redirect and never
  // fires again for a second account that also hasn't completed setup.
  useEffect(() => {
    redirected.current = false;
  }, [settings.created_at, settings.setup_completed]);

  useEffect(() => {
    // Wait for the actual settings to load (created_at is "" in the
    // default placeholder).
    if (!settings.created_at) return;
    if (settings.setup_completed) return;
    if (isExempt(pathname)) return;
    if (redirected.current) return;
    redirected.current = true;
    router.replace("/setup");
  }, [settings.created_at, settings.setup_completed, pathname, router]);

  return null;
}
