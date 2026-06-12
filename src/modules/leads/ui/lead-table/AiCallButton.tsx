"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "AI Call" button shown on the lead card. Triggers the voice agent to
 * call this lead immediately (manual trigger, ignoring call window).
 */
export function AiCallButton({ leadId }: { leadId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");

  async function trigger() {
    if (loading) return;
    setLoading(true);
    setResult("idle");
    try {
      const res = await fetch("/api/voice/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, manual: true }),
      });
      if (res.ok) {
        setResult("success");
      } else {
        const json = await res.json().catch(() => ({}));
        console.error("AI call trigger failed:", json);
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setLoading(false);
      setTimeout(() => setResult("idle"), 3000);
    }
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={loading}
      title="AI Call — voice agent calls this lead now"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-medium transition active:scale-[0.97]",
        result === "success"
          ? "bg-green-100 text-green-700"
          : result === "error"
          ? "bg-red-100 text-red-700"
          : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
      )}
    >
      <Bot className="h-3.5 w-3.5" />
      {loading ? "Calling…" : result === "success" ? "Call placed" : result === "error" ? "Failed" : "AI Call"}
    </button>
  );
}
