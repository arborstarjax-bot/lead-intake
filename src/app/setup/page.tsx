"use client";

/**
 * Setup wizard shown to new workspaces on first sign-in. Three steps:
 *   1. Company info — name, phone, email
 *   2. Starting location — home address (required for route planner)
 *   3. Salesperson — at least one name for SMS/email templates
 *
 * On completion, sets `setup_completed = true` and redirects to `/`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  MapPin,
  UserPlus,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Company info
  const [companyName, setCompanyName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  // Step 2: Starting location
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  // Step 3: Salespeople
  const [salesperson, setSalesperson] = useState("");

  function canAdvance(): boolean {
    if (step === 1) return companyName.trim().length > 0;
    if (step === 2)
      return (
        address.trim().length > 0 &&
        city.trim().length > 0 &&
        state.trim().length > 0
      );
    if (step === 3) return salesperson.trim().length > 0;
    return false;
  }

  async function finish() {
    if (saving || !canAdvance()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim() || null,
          company_phone: companyPhone.trim() || null,
          company_email: companyEmail.trim() || null,
          home_address: address.trim() || null,
          home_city: city.trim() || null,
          home_state: state.trim().toUpperCase() || null,
          home_zip: zip.trim() || null,
          salespeople: salesperson.trim()
            ? [salesperson.trim()]
            : [],
          default_salesperson: salesperson.trim() || null,
          setup_completed: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Something went wrong — try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const steps: { icon: typeof Building2; label: string }[] = [
    { icon: Building2, label: "Company" },
    { icon: MapPin, label: "Location" },
    { icon: UserPlus, label: "Salesperson" },
  ];

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo variant="full" size="lg" priority />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome! Let&apos;s get set up
            </h1>
            <p className="text-sm text-[var(--muted)]">
              Fill in the basics so your routes, texts, and emails work
              from day one.
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((s, i) => {
            const num = (i + 1) as Step;
            const Icon = s.icon;
            const active = step === num;
            const done = step > num;
            return (
              <button
                key={num}
                type="button"
                onClick={() => {
                  if (done || active) setStep(num);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors",
                  active
                    ? "bg-[var(--accent)] text-white"
                    : done
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)]"
                )}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-4">
          {step === 1 && (
            <>
              <div>
                <h2 className="font-semibold">Company info</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  This fills the {"{companyName}"} and {"{companyPhone}"}{" "}
                  placeholders in your SMS and email templates.
                </p>
              </div>
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Company name <span className="text-red-500">*</span>
                </div>
                <input
                  className={inputCls}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Arbor Tech 904"
                  autoFocus
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    Phone
                  </div>
                  <input
                    className={inputCls}
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="(904) 555-0100"
                    inputMode="tel"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    Email
                  </div>
                  <input
                    className={inputCls}
                    value={companyEmail}
                    onChange={(e) => setCompanyEmail(e.target.value)}
                    placeholder="hello@company.com"
                    inputMode="email"
                  />
                </label>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h2 className="font-semibold">Starting location</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Where your workday begins. The route planner uses this
                  to calculate drive times and optimize stop order.
                </p>
              </div>
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Street address <span className="text-red-500">*</span>
                </div>
                <input
                  className={inputCls}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St"
                  autoComplete="street-address"
                  autoFocus
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    City <span className="text-red-500">*</span>
                  </div>
                  <input
                    className={inputCls}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Jacksonville"
                    autoComplete="address-level2"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    State <span className="text-red-500">*</span>
                  </div>
                  <input
                    className={inputCls}
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="FL"
                    maxLength={2}
                    autoComplete="address-level1"
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    Zip
                  </div>
                  <input
                    className={inputCls}
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="32210"
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                </label>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <h2 className="font-semibold">Your name</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  This fills the {"{salesPerson}"} placeholder in SMS
                  and email templates. You can add more team members in
                  Settings later.
                </p>
              </div>
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Salesperson name <span className="text-red-500">*</span>
                </div>
                <input
                  className={inputCls}
                  value={salesperson}
                  onChange={(e) => setSalesperson(e.target.value)}
                  placeholder="John Smith"
                  autoFocus
                />
              </label>
            </>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((step - 1) as Step)}
              className="inline-flex items-center gap-2 rounded-xl h-12 px-5 text-sm font-medium border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((step + 1) as Step)}
              disabled={!canAdvance()}
              className={cn(
                "ml-auto inline-flex items-center gap-2 rounded-xl h-12 px-6 text-sm font-semibold text-white transition-colors",
                canAdvance()
                  ? "bg-[var(--accent)] hover:opacity-95 active:scale-[0.98]"
                  : "bg-gray-300 cursor-not-allowed"
              )}
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={saving || !canAdvance()}
              className={cn(
                "ml-auto inline-flex items-center gap-2 rounded-xl h-12 px-6 text-sm font-semibold text-white transition-colors",
                canAdvance() && !saving
                  ? "bg-[var(--accent)] hover:opacity-95 active:scale-[0.98]"
                  : "bg-gray-300 cursor-not-allowed"
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Finish setup
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
