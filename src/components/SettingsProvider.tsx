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

type Ctx = {
  settings: ClientAppSettings;
  refresh: () => Promise<void>;
  /** Locally patch the in-memory copy (e.g. after an optimistic save). */
  apply: (patch: Partial<ClientAppSettings>) => void;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ClientAppSettings>(DEFAULT_CLIENT_SETTINGS);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json?.settings) {
        // Merge over defaults so missing columns (e.g. before the tailoring
        // migration runs) don't erase sensible defaults.
        setSettings({
          ...DEFAULT_CLIENT_SETTINGS,
          ...(json.settings as Partial<ClientAppSettings>),
        });
      }
    } catch {
      // Non-fatal; callers fall back to DEFAULT_CLIENT_SETTINGS.
    }
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    refresh();
  }, [refresh]);

  const apply = useCallback((patch: Partial<ClientAppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<Ctx>(
    () => ({ settings, refresh, apply }),
    [settings, refresh, apply]
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
    refresh: async () => {},
    apply: () => {},
  };
}
