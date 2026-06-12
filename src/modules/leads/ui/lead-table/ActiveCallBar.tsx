"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone } from "lucide-react";

interface ActiveCall {
  id: string;
  lead_id: string;
  lead_name: string;
  status: "queued" | "ringing" | "in_progress";
  started_at: string;
}

/**
 * Shows a slim status bar at the top of the leads page when a single AI call
 * is in progress (not part of a campaign — campaigns have their own bar).
 */
export function ActiveCallBar() {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/active");
      if (res.ok) {
        const json = await res.json();
        setCall(json.active ?? null);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  // Poll for active call every 2 seconds
  useEffect(() => {
    fetchActive();
    const interval = setInterval(fetchActive, 2000);
    return () => clearInterval(interval);
  }, [fetchActive]);

  // Tick the elapsed timer every second while a call is active
  useEffect(() => {
    if (!call) {
      setElapsed(0);
      return;
    }
    const start = new Date(call.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call]);

  if (!call) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  const statusText =
    call.status === "queued"
      ? "Queued"
      : call.status === "ringing"
      ? "Ringing…"
      : "In progress";

  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50/70 px-4 py-2.5 shadow-sm">
      <div className="relative flex items-center justify-center">
        <Phone className="h-4 w-4 text-green-700" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-green-900">
            AI Calling
          </span>
          <span className="text-xs text-green-700">{statusText}</span>
          <span className="text-xs font-mono text-green-600">{timeStr}</span>
        </div>
        <div className="text-xs text-green-800 truncate">
          {call.lead_name}
        </div>
      </div>
      {call.status === "in_progress" && (
        <div className="flex gap-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      )}
    </div>
  );
}
