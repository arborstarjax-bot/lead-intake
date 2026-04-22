"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/components/Toast";

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function openPortal() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data: { url?: string; error?: string; detail?: string } = await res
        .json()
        .catch(() => ({ error: "bad response" }));
      if (!res.ok || !data.url) {
        throw new Error(data.detail || data.error || `http ${res.status}`);
      }
      window.location.href = data.url;
    } catch (err) {
      setLoading(false);
      toast({
        kind: "error",
        message:
          err instanceof Error
            ? `Could not open billing portal: ${err.message}`
            : "Could not open billing portal",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={openPortal}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 h-9 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ExternalLink className="h-4 w-4" />
      )}
      Manage billing
    </button>
  );
}
