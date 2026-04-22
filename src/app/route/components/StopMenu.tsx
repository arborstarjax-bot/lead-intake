"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  MoreVertical,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAppSettings } from "@/components/SettingsProvider";
import { renderTemplate, smsConfirmTemplate } from "@/lib/templates";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { formatClock, formatDateLong } from "../route-helpers";

export function StopMenu({
  leadId,
  label,
  firstName,
  phoneNumber,
  salesPerson,
  startTime,
  date,
  onReload,
  onFlash,
}: {
  leadId: string;
  label: string;
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
  startTime: string;
  date: string;
  onReload: () => void;
  onFlash: (msg: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const confirmDialog = useConfirm();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  async function cancel() {
    const ok = await confirmDialog({
      title: `Unbook ${label}?`,
      message: "This removes it from the calendar and moves it back to Called.",
      confirmLabel: "Unbook",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/calendar`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ kind: "error", message: j.error ?? `Failed (${res.status})` });
        return;
      }
      onFlash(`Unbooked ${label}`);
      onReload();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  function reschedule() {
    setOpen(false);
    router.push(`/route?scheduleLead=${leadId}&day=${date}`);
  }

  const { settings } = useAppSettings();
  const smsHref = useMemo(() => {
    if (!phoneNumber) return null;
    const who = firstName?.trim() || "there";
    const dayLabel = formatDateLong(date);
    const timeLabel = formatClock(startTime);
    const body = renderTemplate(smsConfirmTemplate(settings), {
      firstName: who,
      // Prefer the lead's own assigned salesperson; fall back to the
      // configured default, then the first roster entry as a last
      // resort so `{salesPerson}` never renders as the literal
      // placeholder when nobody is explicitly assigned.
      salesPerson:
        salesPerson?.trim() ||
        settings.default_salesperson?.trim() ||
        settings.salespeople?.[0]?.trim() ||
        "",
      companyName: (settings.company_name ?? "").trim(),
      companyPhone: (settings.company_phone ?? "").trim(),
      companyEmail: (settings.company_email ?? "").trim(),
      day: dayLabel,
      time: timeLabel,
    });
    const digits = phoneNumber.replace(/[^\d+]/g, "");
    // `?` (RFC 5724) is the only separator Android accepts — `&` gets
    // absorbed into the phone-number portion so the prefilled body drops.
    // iOS accepts both, so `?` is safe on iPhone too.
    return `sms:${digits}?body=${encodeURIComponent(body)}`;
  }, [firstName, phoneNumber, salesPerson, date, startTime, settings]);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Stop actions"
        className="inline-flex items-center justify-center h-8 w-8 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-10 w-48 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
          {smsHref && (
            <a
              href={smsHref}
              onClick={() => setOpen(false)}
              className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)]"
            >
              <MessageSquare className="h-4 w-4" /> Text confirmation
            </a>
          )}
          <button
            onClick={reschedule}
            disabled={busy}
            className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)]"
          >
            <RefreshCw className="h-4 w-4" /> Reschedule
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="w-full text-left px-3 h-10 text-sm flex items-center gap-2 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}
