"use client";

/**
 * Fetches the singleton `app_settings` row on mount and exposes it to any
 * client component via `useAppSettings`. Used by LeadCard (SMS / email
 * templates, salesperson chip list), ScheduleModal (confirm SMS), and the
 * Route page (confirm SMS) so tailoring from the Settings page lights up
 * everywhere without a page reload.
 *
 * Tiny, no caching library — one fetch per page load, plus a refresh()
 * method for the Settings page to call after it saves.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientAppSettings,
} from "@/lib/client-settings";
import { createClient } from "@/modules/shared/supabase/client";

export type WorkspaceRole = "admin" | "user";

type Ctx = {
  settings: ClientAppSettings;
  /** Role of the current user in the current workspace; null while loading. */
  role: WorkspaceRole | null;
  refresh: () => Promise<void>;
  /** Locally patch the in-memory copy (e.g. after an optimistic save). */
  apply: (patch: Partial<ClientAppSettings>) => void;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) {
        // If the user is signed out the API returns 401. Reset to
        // defaults so stale workspace data is never shown.
        if (res.status === 401) {
          setSettings(DEFAULT_CLIENT_SETTINGS);
          setRole(null);
        }
        return;
      }
      const json = await res.json();
      if (json?.settings) {
        // Merge over defaults so missing columns (e.g. before the tailoring
        // migration runs) don't erase sensible defaults.
        setSettings({
          ...DEFAULT_CLIENT_SETTINGS,
          ...(json.settings as Partial<ClientAppSettings>),
        });
      }
      if (json?.role === "admin" || json?.role === "user") {
        setRole(json.role);
      }
    } catch {
      // Non-fatal; callers fall back to DEFAULT_CLIENT_SETTINGS.
    }
  }, []);

  // Initial fetch on mount.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    refresh();
  }, [refresh]);

  // Re-fetch whenever the Supabase auth state changes (sign-in,
  // sign-out, token refresh). Without this, the root-layout provider
  // keeps stale settings from a previous account after a client-side
  // navigation through /login, causing workspace variable leakage.
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (
          event === "SIGNED_IN" ||
          event === "SIGNED_OUT" ||
          event === "TOKEN_REFRESHED"
        ) {
          // On sign-out, immediately clear stale workspace data so it's
          // never shown even if the subsequent fetch fails.
          if (event === "SIGNED_OUT") {
            setSettings(DEFAULT_CLIENT_SETTINGS);
            setRole(null);
          }
          // Reset the loaded guard so subsequent SIGNED_IN events
          // also trigger a fetch (not just the first one).
          loaded.current = false;
          refresh();
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [refresh]);

  const apply = useCallback((patch: Partial<ClientAppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<Ctx>(
    () => ({ settings, role, refresh, apply }),
    [settings, role, refresh, apply]
  );

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useAppSettings(): Ctx {
  const ctx = useContext(SettingsCtx);
  if (ctx) return ctx;
  // No provider mounted — hand back an inert, default settings object so
  // callers never crash in tests or isolated renders.
  return {
    settings: DEFAULT_CLIENT_SETTINGS,
    role: null,
    refresh: async () => {},
    apply: () => {},
  };
}
