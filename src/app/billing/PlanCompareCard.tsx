"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/components/Toast";
import type { BillingState } from "@/lib/billing";

export function PlanCompareCard({ billing }: { billing: BillingState }) {
  const currentPlan = billing.plan;
  const [starting, setStarting] = useState<"starter" | "pro" | null>(null);
  const { toast } = useToast();

  async function startCheckout(plan: "starter" | "pro") {
    if (starting) return;
    setStarting(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data: { url?: string; error?: string } = await res
        .json()
        .catch(() => ({ error: "bad response" }));
      if (!res.ok || !data.url) {
        throw new Error(data.error || `http ${res.status}`);
      }
      // Full-page redirect to Stripe. No router.push — we want a hard nav.
      window.location.href = data.url;
    } catch (err) {
      setStarting(null);
      toast({
        kind: "error",
        message:
          err instanceof Error
            ? `Could not start checkout: ${err.message}`
            : "Could not start checkout",
      });
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Plans
        </div>
        <h2 className="text-base font-semibold mt-0.5">Compare tiers</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PlanTile
          name="Starter"
          price="$29.99/mo"
          seatAddon="$9.99 per additional user"
          features={[
            "30 uploads / day (shared across workspace)",
            "1 seat included",
            "Unlimited members (add seats as needed)",
            "Calendar + SMS automation",
          ]}
          current={currentPlan === "starter"}
          isTrial={currentPlan === "trial"}
          loading={starting === "starter"}
          disabled={starting !== null}
          onSelect={() => startCheckout("starter")}
        />
        <PlanTile
          name="Pro"
          price="$59.99/mo"
          seatAddon="$9.99 per additional user"
          features={[
            "Unlimited uploads",
            "1 seat included",
            "Unlimited members (add seats as needed)",
            "Everything in Starter",
          ]}
          highlight
          current={currentPlan === "pro"}
          isTrial={currentPlan === "trial"}
          loading={starting === "pro"}
          disabled={starting !== null}
          onSelect={() => startCheckout("pro")}
        />
      </div>

      <p className="text-xs text-[var(--muted)]">
        Both tiers include a 14-day free trial — cards aren&apos;t charged until
        the trial ends, and you can cancel any time.
      </p>
    </section>
  );
}

function PlanTile({
  name,
  price,
  seatAddon,
  features,
  highlight,
  current,
  isTrial,
  loading,
  disabled,
  onSelect,
}: {
  name: string;
  price: string;
  seatAddon: string;
  features: string[];
  highlight?: boolean;
  current: boolean;
  isTrial: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        highlight
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/20 bg-[var(--accent-soft)]/40"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{name}</span>
            {highlight && (
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            )}
          </div>
          <div className="text-lg font-semibold mt-0.5">{price}</div>
          <div className="text-xs text-[var(--muted)]">{seatAddon}</div>
        </div>
        {current && (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
            Current
          </span>
        )}
      </div>
      <ul className="space-y-1.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={current || disabled}
        onClick={onSelect}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--accent-hover)] transition-colors"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {current
          ? "Current plan"
          : isTrial
            ? `Start ${name}`
            : `Switch to ${name}`}
      </button>
    </div>
  );
}
