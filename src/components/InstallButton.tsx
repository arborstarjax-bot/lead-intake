"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallButton() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // iOS Safari never fires beforeinstallprompt; detect standalone mode.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone);
    if (standalone) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleClick() {
    if (event) {
      await event.prompt();
      await event.userChoice;
      setEvent(null);
      return;
    }
    // iOS fallback: show manual A2HS instructions.
    setShowIOSHelp(true);
  }

  if (installed) return null;

  return (
    <>
      <button
        onClick={handleClick}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--fg)] text-white px-4 py-3 font-medium w-full"
      >
        <Download className="h-5 w-5" />
        Download App
      </button>
      {showIOSHelp && (
        <div
          onClick={() => setShowIOSHelp(false)}
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3"
          >
            <h3 className="font-semibold">Add to Home Screen</h3>
            <p className="text-sm">
              On iPhone, tap the <strong>Share</strong> button in Safari (the
              square with the up-arrow), then scroll and tap{" "}
              <strong>Add to Home Screen</strong>. The app icon will land on
              your home screen and open like a native app.
            </p>
            <p className="text-xs text-[var(--muted)]">
              On Android / desktop Chrome, the install prompt appears in the
              address bar when available.
            </p>
            <button
              onClick={() => setShowIOSHelp(false)}
              className="w-full rounded-lg bg-[var(--fg)] text-white py-2 font-medium"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
