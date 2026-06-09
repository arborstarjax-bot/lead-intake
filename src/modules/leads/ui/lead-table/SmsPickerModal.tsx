"use client";

/**
 * Modal that lets the user pick which SMS template to send when they
 * tap the text-message icon on a lead card, estimate row, or stop menu.
 *
 * Options:
 *   1. Introduction  — first-touch intro template
 *   2. Scheduling Confirmation — booking confirmation template
 *   3. En Route — "on my way" template
 *   4. Blank — opens sms: with no body
 *
 * Each option shows a rendered preview so the user can see exactly
 * what will be sent before tapping. Tapping opens the native `sms:`
 * link and logs a contact activity.
 */

import { useMemo } from "react";
import {
  MessageSquare,
  Send,
  Navigation,
  FileText,
  X,
} from "lucide-react";
import type { ClientAppSettings } from "@/lib/client-settings";
import {
  renderTemplate,
  smsIntroTemplate,
  smsConfirmTemplate,
  smsEnrouteTemplate,
  type TemplateVars,
} from "@/lib/templates";

export type SmsTemplateVars = TemplateVars;

type Props = {
  phone: string;
  vars: TemplateVars;
  settings: ClientAppSettings;
  onClose: () => void;
  /** Called when the user taps a template. Receives the kind for
   *  activity logging. The parent should log the activity and let
   *  the sms: link navigate. */
  onSelect?: (kind: "intro" | "confirm" | "enroute" | "blank") => void;
};

type SmsOption = {
  key: "intro" | "confirm" | "enroute" | "blank";
  label: string;
  icon: typeof MessageSquare;
  body: string;
};

export function SmsPickerModal({
  phone,
  vars,
  settings,
  onClose,
  onSelect,
}: Props) {
  const digits = phone.replace(/[^\d+]/g, "");

  const options = useMemo<SmsOption[]>(() => {
    const intro = renderTemplate(smsIntroTemplate(settings), vars);
    const confirm = renderTemplate(smsConfirmTemplate(settings), vars);
    const enroute = renderTemplate(smsEnrouteTemplate(settings), vars);
    return [
      { key: "intro", label: "Introduction", icon: MessageSquare, body: intro },
      { key: "confirm", label: "Scheduling Confirmation", icon: Send, body: confirm },
      { key: "enroute", label: "En Route", icon: Navigation, body: enroute },
      { key: "blank", label: "Blank Text", icon: FileText, body: "" },
    ];
  }, [settings, vars]);

  function buildHref(body: string): string {
    if (!body) return `sms:${digits}`;
    return `sms:${digits}?body=${encodeURIComponent(body)}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm">Send a text message</h3>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <a
                key={opt.key}
                href={buildHref(opt.body)}
                onClick={() => {
                  onSelect?.(opt.key);
                  onClose();
                }}
                className="block w-full rounded-xl border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition p-3 text-left"
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-sm">{opt.label}</span>
                </div>
                {opt.body ? (
                  <p className="text-xs text-[var(--muted)] line-clamp-2 ml-10">
                    {opt.body}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--muted)] italic ml-10">
                    Opens a blank text message
                  </p>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
