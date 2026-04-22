import type React from "react";
import { MessageSquare, Truck } from "lucide-react";
import type { Lead } from "@/lib/types";
import type { ClientAppSettings } from "@/lib/client-settings";
import { ActionIconLink } from "./ActionIconLink";
import { InlineField } from "./InlineField";
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
}: {
  icon: React.ReactNode;
  tel?: boolean;
  email?: boolean;
  lead: Lead;
  field: "phone_number" | "email";
  onPatch: (p: Partial<Lead>) => void;
  settings: ClientAppSettings;
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

  return (
    <div className="flex items-stretch gap-1">
      <ActionIconLink href={primaryHref} title={tel ? "Call" : "Email"}>
        {icon}
      </ActionIconLink>
      {tel && (
        <ActionIconLink href={smsHref} title="Send intro text message">
          <MessageSquare className="h-4 w-4" />
        </ActionIconLink>
      )}
      {tel && (
        <ActionIconLink href={enrouteHref} title="Send 'on my way' text message">
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
