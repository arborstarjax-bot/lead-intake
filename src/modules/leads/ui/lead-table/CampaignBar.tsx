"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, Pause, Play, Square, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface CampaignResult {
  lead_id: string;
  name: string;
  outcome: string;
  summary: string | null;
}

interface Campaign {
  id: string;
  status: "running" | "paused" | "completed" | "cancelled";
  filter: "new" | "needs_follow_up";
  total_leads: number;
  completed_leads: number;
  current_lead_id: string | null;
  results: CampaignResult[];
  created_at: string;
}

interface CampaignBarProps {
  /** Current filter tab — determines which campaign button to show */
  filter: string;
}

export function CampaignBar({ filter }: CampaignBarProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [starting, setStarting] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [currentLeadName, setCurrentLeadName] = useState<string | null>(null);

  // Only show for New and Called / No Response tabs
  const campaignFilter = filter === "New" ? "new" : filter === "Called / No Response" ? "needs_follow_up" : null;
  const showButton = campaignFilter !== null;

  // Poll for campaign status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/campaign");
      if (res.ok) {
        const json = await res.json();
        const c = json.campaign as Campaign | null;
        setCampaign(c);
        if (c?.current_lead_id && (c.status === "running" || c.status === "paused")) {
          // Find lead name from results or use current
          const lastResult = c.results[c.results.length - 1];
          if (lastResult && lastResult.lead_id !== c.current_lead_id) {
            setCurrentLeadName(null); // Will resolve on next poll
          }
        }
      }
    } catch {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function startCampaign() {
    if (!campaignFilter) return;
    setStarting(true);
    try {
      const res = await fetch("/api/voice/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter: campaignFilter }),
      });
      const json = await res.json();
      if (res.ok) {
        setCampaign(json.campaign);
      } else {
        alert(json.error ?? "Failed to start campaign");
      }
    } finally {
      setStarting(false);
    }
  }

  async function controlCampaign(action: "pause" | "resume" | "stop") {
    setControlling(true);
    try {
      const res = await fetch("/api/voice/campaign/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await fetchStatus();
      }
    } finally {
      setControlling(false);
    }
  }

  // Active campaign exists
  const isActive = campaign && (campaign.status === "running" || campaign.status === "paused");
  const isCompleted = campaign && campaign.status === "completed";
  const recentlyCompleted = isCompleted && (Date.now() - new Date(campaign.created_at).getTime()) < 60 * 60 * 1000; // within last hour

  // Don't show anything if not on a relevant tab and no active campaign
  if (!showButton && !isActive && !recentlyCompleted) return null;

  // Show campaign button only
  if (!isActive && !recentlyCompleted && showButton) {
    return (
      <button
        onClick={startCampaign}
        disabled={starting}
        className="mb-3 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 active:scale-[0.98] transition disabled:opacity-60"
      >
        {starting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
        {campaignFilter === "new" ? "Call All New Leads" : "Call All Follow-Ups"}
      </button>
    );
  }

  // Show progress bar for active or recently completed campaign
  if (!campaign) return null;

  const progress = campaign.total_leads > 0
    ? Math.round((campaign.completed_leads / campaign.total_leads) * 100)
    : 0;

  // Get the current calling lead name from results context
  const currentName = campaign.current_lead_id
    ? currentLeadName ?? "Calling..."
    : null;

  return (
    <div className="mb-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {campaign.status === "running" && (
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          )}
          {campaign.status === "paused" && (
            <div className="h-2 w-2 rounded-full bg-yellow-500" />
          )}
          {campaign.status === "completed" && (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          {campaign.status === "cancelled" && (
            <XCircle className="h-4 w-4 text-gray-500" />
          )}
          <span className="text-sm font-semibold text-purple-900">
            {campaign.status === "running" && "Campaign Running"}
            {campaign.status === "paused" && "Campaign Paused"}
            {campaign.status === "completed" && "Campaign Complete"}
            {campaign.status === "cancelled" && "Campaign Cancelled"}
          </span>
          <span className="text-xs text-purple-700">
            {campaign.completed_leads}/{campaign.total_leads} calls
          </span>
        </div>

        {/* Controls */}
        {(campaign.status === "running" || campaign.status === "paused") && (
          <div className="flex items-center gap-1.5">
            {campaign.status === "running" && (
              <button
                onClick={() => controlCampaign("pause")}
                disabled={controlling}
                className="rounded-lg p-1.5 text-purple-700 hover:bg-purple-200 transition"
                title="Pause"
              >
                <Pause className="h-4 w-4" />
              </button>
            )}
            {campaign.status === "paused" && (
              <button
                onClick={() => controlCampaign("resume")}
                disabled={controlling}
                className="rounded-lg p-1.5 text-green-700 hover:bg-green-100 transition"
                title="Resume"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => controlCampaign("stop")}
              disabled={controlling}
              className="rounded-lg p-1.5 text-red-600 hover:bg-red-100 transition"
              title="Stop Campaign"
            >
              <Square className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-purple-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-purple-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Currently calling */}
      {campaign.status === "running" && campaign.current_lead_id && (
        <div className="flex items-center gap-2 text-xs text-purple-800">
          <Phone className="h-3 w-3 animate-pulse" />
          <span>Now calling: {currentName}</span>
        </div>
      )}

      {/* Results feed (last 5) */}
      {campaign.results.length > 0 && (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {campaign.results.slice(-5).reverse().map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className={outcomeClass(r.outcome)}>
                {outcomeIcon(r.outcome)} {r.outcome}
              </span>
              <span className="font-medium text-purple-900 truncate">{r.name}</span>
              {r.summary && (
                <span className="text-purple-600 truncate hidden sm:inline">— {r.summary}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completion summary */}
      {campaign.status === "completed" && campaign.results.length > 0 && (
        <div className="text-xs text-purple-800 font-medium pt-1 border-t border-purple-200">
          Summary: {campaign.results.filter((r) => r.outcome === "Answered").length} answered,{" "}
          {campaign.results.filter((r) => r.outcome === "Left VM" || r.outcome === "Voicemail").length} voicemail,{" "}
          {campaign.results.filter((r) => r.outcome === "No answer").length} no answer,{" "}
          {campaign.results.filter((r) => r.outcome === "Failed").length > 0 && `${campaign.results.filter((r) => r.outcome === "Failed").length} failed`}
        </div>
      )}
    </div>
  );
}

function outcomeClass(outcome: string): string {
  if (outcome === "Answered") return "text-green-700";
  if (outcome === "Left VM" || outcome === "Voicemail") return "text-blue-700";
  if (outcome === "No answer") return "text-yellow-700";
  return "text-red-600";
}

function outcomeIcon(outcome: string): string {
  if (outcome === "Answered") return "✓";
  if (outcome === "Left VM" || outcome === "Voicemail") return "✉";
  if (outcome === "No answer") return "—";
  return "✗";
}
