"use client";

/**
 * Setup wizard shown to new workspaces on first sign-in. Five steps:
 *   1. Company info — name, phone, email, business type
 *   2. Starting location — home address (required for route planner)
 *   3. Working hours — start/end time, work days, timezone
 *   4. Salesperson — at least one name for SMS/email templates
 *   5. AI Calling — optional activation of the AI voice agent
 *
 * On completion, sets `setup_completed = true` and redirects to `/`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  MapPin,
  Clock,
  UserPlus,
  Phone,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAppSettings } from "@/components/SettingsProvider";
import { useToast } from "@/components/Toast";
import { AddressInput } from "@/components/AddressInput";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4 | 5;

const TOTAL_STEPS = 5;

const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];

export default function SetupWizard() {
  const router = useRouter();
  const { refresh } = useAppSettings();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Company info
  const [companyName, setCompanyName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [businessType, setBusinessType] = useState("");

  // Step 2: Starting location
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  // Step 3: Working hours
  const [workStart, setWorkStart] = useState("08:00");
  const [workEnd, setWorkEnd] = useState("17:00");
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5, 6]);
  const [timezone, setTimezone] = useState("America/New_York");

  // Step 4: Salespeople
  const [salesperson, setSalesperson] = useState("");
  const [salespersonTitle, setSalespersonTitle] = useState("");

  // Step 5: AI Calling
  const [enableAI, setEnableAI] = useState(false);
  const [agentName, setAgentName] = useState("Dave");
  const [provisioning, setProvisioning] = useState(false);
  const [provisioned, setProvisioned] = useState(false);

  function toggleDay(d: number) {
    setWorkDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  }

  function canAdvance(): boolean {
    if (step === 1) return companyName.trim().length > 0;
    if (step === 2)
      return (
        address.trim().length > 0 &&
        city.trim().length > 0 &&
        state.trim().length > 0
      );
    if (step === 3) return workDays.length > 0;
    if (step === 4) return salesperson.trim().length > 0;
    if (step === 5) return true; // AI calling is optional
    return false;
  }

  async function provisionAI() {
    if (provisioning || provisioned) return;
    setProvisioning(true);
    try {
      // First enable voice config with agent name
      await fetch("/api/voice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, agent_name: agentName.trim() || "Dave" }),
      });
      // Then provision
      const res = await fetch("/api/voice/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ kind: "error", message: json.error ?? "Provisioning failed" });
        return;
      }
      setProvisioned(true);
      toast({ kind: "success", message: "AI assistant activated!" });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setProvisioning(false);
    }
  }

  async function finish() {
    if (saving) return;
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
          business_type: businessType.trim() || null,
          home_address: address.trim() || null,
          home_city: city.trim() || null,
          home_state: state.trim().toUpperCase() || null,
          home_zip: zip.trim() || null,
          work_start_time: workStart,
          work_end_time: workEnd,
          work_days: workDays,
          timezone,
          salespeople: salesperson.trim()
            ? [salesperson.trim()]
            : [],
          salesperson_titles: salesperson.trim() && salespersonTitle.trim()
            ? { [salesperson.trim()]: salespersonTitle.trim() }
            : {},
          default_salesperson: salesperson.trim() || null,
          setup_completed: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Something went wrong — try again.");
        return;
      }
      await refresh();
      router.replace("/");
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const steps: { icon: typeof Building2; label: string }[] = [
    { icon: Building2, label: "Company" },
    { icon: MapPin, label: "Location" },
    { icon: Clock, label: "Hours" },
    { icon: UserPlus, label: "You" },
    { icon: Phone, label: "AI Calling" },
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
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
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
                  "flex items-center gap-1.5 rounded-full px-2.5 h-8 text-xs font-medium transition-colors",
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
                  placeholder="Your Company Name"
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
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Business type
                </div>
                <input
                  className={inputCls}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="e.g. Plumbing, HVAC, Tree Care, Landscaping"
                />
              </label>
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
              <div className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Street address <span className="text-red-500">*</span>
                </div>
                <AddressInput
                  className={inputCls}
                  value={address}
                  onChange={setAddress}
                  onSelect={(parts) => {
                    setAddress(parts.street);
                    setCity(parts.city);
                    setState(parts.state);
                    setZip(parts.zip);
                  }}
                  autoFocus
                />
              </div>
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
                <h2 className="font-semibold">Working hours</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  When your team is available. The scheduler, AI calls,
                  and route planner all respect these hours.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    Start time
                  </div>
                  <input
                    type="time"
                    className={inputCls}
                    value={workStart}
                    onChange={(e) => setWorkStart(e.target.value)}
                  />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-[var(--muted)] mb-1">
                    End time
                  </div>
                  <input
                    type="time"
                    className={inputCls}
                    value={workEnd}
                    onChange={(e) => setWorkEnd(e.target.value)}
                  />
                </label>
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--muted)] mb-2">
                  Work days <span className="text-red-500">*</span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={cn(
                        "h-9 w-11 rounded-lg text-xs font-semibold transition-colors",
                        workDays.includes(d.value)
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-3)]"
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Timezone
                </div>
                <select
                  className={inputCls}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {step === 4 && (
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
              <label className="block">
                <div className="text-xs font-medium text-[var(--muted)] mb-1">
                  Title
                </div>
                <input
                  className={inputCls}
                  value={salespersonTitle}
                  onChange={(e) => setSalespersonTitle(e.target.value)}
                  placeholder="e.g. Sales Rep, Estimator, Account Manager"
                />
              </label>
            </>
          )}

          {step === 5 && (
            <>
              <div>
                <h2 className="font-semibold">AI Calling</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Let our AI assistant call your leads to book
                  appointments automatically. You can always enable this
                  later in Settings.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Enable AI calling</div>
                    <div className="text-xs text-[var(--muted)]">
                      AI calls leads to schedule estimates
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEnableAI((v) => !v);
                      setProvisioned(false);
                    }}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      enableAI ? "bg-[var(--accent)]" : "bg-gray-200"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                        enableAI ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
                {enableAI && (
                  <label className="block">
                    <div className="text-xs font-medium text-[var(--muted)] mb-1">
                      Agent name
                    </div>
                    <input
                      className={inputCls}
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="Dave"
                    />
                    <p className="text-xs text-[var(--muted)] mt-1">
                      The name your AI will use when calling leads.
                    </p>
                  </label>
                )}
                {enableAI && !provisioned && (
                  <button
                    type="button"
                    onClick={provisionAI}
                    disabled={provisioning}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-2 rounded-xl h-11 text-sm font-semibold text-white transition-colors",
                      provisioning
                        ? "bg-gray-300 cursor-not-allowed"
                        : "bg-[var(--accent)] hover:opacity-95 active:scale-[0.98]"
                    )}
                  >
                    {provisioning ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Activating…
                      </>
                    ) : (
                      <>
                        <Phone className="h-4 w-4" />
                        Activate AI Assistant
                      </>
                    )}
                  </button>
                )}
                {provisioned && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                    <Check className="h-4 w-4" />
                    AI assistant activated! You can configure it in Settings later.
                  </div>
                )}
              </div>
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
          {step < TOTAL_STEPS ? (
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
              disabled={saving}
              className={cn(
                "ml-auto inline-flex items-center gap-2 rounded-xl h-12 px-6 text-sm font-semibold text-white transition-colors",
                !saving
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
