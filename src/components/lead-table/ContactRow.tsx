import type React from "react";
import { MessageSquare, Truck } from "lucide-react";
import type { Lead } from "@/lib/types";
import type { ClientAppSettings } from "@/lib/client-settings";
import { ActionIconLink } from "./ActionIconLink";
import { InlineField } from "./InlineField";
import { logContactActivity } from "./LifecycleTimeline";
import {
  buildMailtoHref,
  buildSmsHref,
  buildEnrouteSmsHref,
} from "./lead-table-helpers";

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
  onPatch: (p: Partial<Lead>) => void;
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
  const smsHref = tel && trimmed ? buildSmsHref(trimmed, lead, settings) : undefined;
  const enrouteHref = tel && trimmed ? buildEnrouteSmsHref(trimmed, lead, settings) : undefined;

  // The browser CAN'T tell us whether a tel: call was answered or missed —
  // that event lives on the phone's dialer, not in the web view. So we log
  // "Customer called" with an indeterminate outcome; if we ever add a
  // native bridge (Capacitor, Expo) that surfaces CallKit / ConnectionService
  // events we can upgrade `outcome` to answered/missed there.
  const logCall = () => {
    if (!tel || !trimmed) return;
    void logContactActivity(lead.id, "customer_called", {
      phone: trimmed,
    }).then(() => onActivityLogged?.());
  };
  const logText = (kind: "intro" | "enroute") => () => {
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
      {tel && (
        <ActionIconLink
          href={smsHref}
          title="Send intro text message"
          onClick={logText("intro")}
        >
          <MessageSquare className="h-4 w-4" />
        </ActionIconLink>
      )}
      {tel && (
        <ActionIconLink
          href={enrouteHref}
          title="Send 'on my way' text message"
          onClick={logText("enroute")}
        >
          <Truck className="h-4 w-4" />
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
    </div>
  );
}
