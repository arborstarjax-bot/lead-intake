"use client";

import { useEffect, useState } from "react";
import { isIosShellWindow } from "./ios-shell";

/**
 * Client hook that returns `true` when the app is running inside the
 * Capacitor / WKWebView iOS shell. See `./ios-shell.ts` for the App
 * Store Guideline 3.1.1 / 3.1.3(b) context — we use this to gate the
 * in-app upgrade CTA on `/billing`, inside `UploadBox`, and anywhere
 * else that would otherwise route the user to Stripe checkout.
 *
 * Starts `false` on the server and first paint to keep SSR / CSR
 * markup identical, then flips synchronously on mount if the probe
 * detects a native shell. No-op on the web.
 */
export function useIsIosShell(): boolean {
  const [isShell, setIsShell] = useState(false);
  useEffect(() => {
    if (isIosShellWindow()) setIsShell(true);
  }, []);
  return isShell;
}
