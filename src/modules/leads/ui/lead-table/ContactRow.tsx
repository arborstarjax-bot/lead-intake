import type React from "react";
import { useState } from "react";
import { MessageSquare, Navigation } from "lucide-react";
import type { Lead, LeadPatch } from "@/modules/leads/model";
import type { ClientAppSettings } from "@/lib/client-settings";
import { ActionIconLink } from "./ActionIconLink";
import { InlineField } from "./InlineField";
import { logContactActivity } from "./LifecycleTimeline";
import {
  buildMailtoHref,
  buildNavigationHref,
  templateVars,
} from "./lead-table-helpers";
import { SmsPickerModal } from "./SmsPickerModal";

export function ContactRow({
  icon,
  tel,
  email,
  lead,
  field,
  onPatch,
  settings,
  onActivityLogged,
}: {
  icon: React.ReactNode;
  tel?: boolean;
  email?: boolean;
  lead: Lead;
  field: "phone_number" | "email";
  onPatch: (p: LeadPatch) => void;
  settings: ClientAppSettings;
  /** Fired after a call/text click has been logged to /api/leads/[id]/activities
   *  so the parent (LeadCard) can bump its timeline refresh key. Nothing
   *  blocks on this — the tel:/sms: nav happens concurrently with the POST. */
  onActivityLogged?: () => void;
}) {
  const raw = (lead[field] ?? "") as string;
  const trimmed = raw.trim();
  const primaryHref = tel && trimmed
    ? `tel:${trimmed}`
    : email && trimmed
    ? buildMailtoHref(trimmed, lead, settings)
    : undefined;
  const navHref = tel ? buildNavigationHref(lead) : undefined;
  const [showSmsPicker, setShowSmsPicker] = useState(false);

  const logCall = () => {
    if (!tel || !trimmed) return;
    void logContactActivity(lead.id, "customer_called", {
      phone: trimmed,
    }).then(() => onActivityLogged?.());
  };

  const logText = (kind: "intro" | "confirm" | "enroute" | "blank") => {
    if (!tel || !trimmed) return;
    void logContactActivity(lead.id, "customer_texted", {
      phone: trimmed,
      kind,
    }).then(() => onActivityLogged?.());
  };

  return (
    <div className="flex items-stretch gap-1">
      <ActionIconLink
        href={primaryHref}
        title={tel ? "Call" : "Email"}
        onClick={tel ? logCall : undefined}
      >
        {icon}
      </ActionIconLink>
      {tel && trimmed && (
        <button
          type="button"
          onClick={() => setShowSmsPicker(true)}
          title="Send text message"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      )}
      {tel && (
        <ActionIconLink
          href={navHref}
          title="Navigate to address"
          className="gps"
        >
          <Navigation className="h-4 w-4" />
        </ActionIconLink>
      )}
      <InlineField
        value={raw}
        placeholder={tel ? "Phone number" : "Email address"}
        lead={lead}
        field={field}
        onPatch={onPatch}
        type={tel ? "tel" : "email"}
        inputMode={tel ? "tel" : "email"}
        className="field-input flex-1"
        formatAs={tel ? "phone" : undefined}
      />
      {showSmsPicker && trimmed && (
        <SmsPickerModal
          phone={trimmed}
          vars={templateVars(lead, settings)}
          settings={settings}
          onClose={() => setShowSmsPicker(false)}
          onSelect={logText}
        />
      )}
    </div>
  );
}
