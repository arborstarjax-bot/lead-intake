"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, LeadPatch } from "@/modules/leads/model";
import { formatPhone } from "@/modules/shared/format";
import { cn } from "@/lib/utils";
import type { FieldDef } from "./lead-table-helpers";

export function InlineField({
  value,
  placeholder,
  lead,
  field,
  onPatch,
  type,
  inputMode,
  className,
  formatAs,
}: {
  value: string;
  placeholder?: string;
  lead: Lead;
  field: keyof Lead;
  onPatch: (p: LeadPatch) => void;
  type?: FieldDef["type"];
  inputMode?: FieldDef["inputMode"];
  className?: string;
  formatAs?: "phone";
}) {
  const [local, setLocal] = useState<string>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `pending` holds the most recent unsaved value so `flush()` can fire
  // the patch synchronously without depending on `local`'s closure.
  const pending = useRef<string | null>(null);
  // Track focus so incoming `value` updates (from the server echo after a
  // debounced save) don't clobber the user's in-flight keystrokes. The
  // previous implementation reset `local` on every `value` change, which
  // swallowed characters typed during the 300–500 ms save round-trip and
  // produced the "choppy" input the user reported.
  const focused = useRef(false);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  useEffect(() => {
    // Only accept incoming value when the field is idle (not focused and
    // no unflushed edit). While the user is typing, the last authoritative
    // value is whatever they just entered — the server echo that arrives
    // mid-keystroke is stale by definition.
    if (focused.current) return;
    if (pending.current !== null) return;
    setLocal(value);
  }, [value]);

  // Keep the latest `lead` reference available to `flush` without
  // re-creating it each keystroke. flush() needs to peek at
  // extraction_confidence at save time to decide whether to clear the
  // AI chip — a stable closure would show stale confidence data.
  const leadRef = useRef(lead);
  leadRef.current = lead;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    const patch: LeadPatch = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patch as any)[field] = next === "" ? null : next;
    // Clear the AI confidence chip for this field when the user
    // overrides an AI-inferred value. Anything the operator types
    // themselves has operator authority, not AI authority — showing
    // "AI 87%" next to their own typed value is misleading. We send
    // `null` via the merge knob so the server deletes just this
    // field's entry from extraction_confidence (other fields keep
    // their scores). Only fires when the field currently has an AI
    // score; otherwise we'd send a no-op merge on every keystroke.
    const currentConf = leadRef.current.extraction_confidence?.[field as string];
    if (typeof currentConf === "number" && currentConf > 0) {
      patch.extraction_confidence_merge = { [field as string]: null };
    }
    onPatchRef.current(patch);
  }, [field]);

  // Fire any pending save when the tab hides, the page unloads, or the
  // input blurs. Without this, a quick edit + tap-home swallows the patch
  // because the 500 ms debounce timer never resolves in the background.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  // Final safety net: flush on unmount too.
  useEffect(() => {
    return () => flush();
  }, [flush]);

  function scheduleSave(next: string) {
    setLocal(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }

  function onFocus() {
    focused.current = true;
  }

  function onBlur() {
    focused.current = false;
    flush();
  }

  const conf = lead.extraction_confidence?.[field as string];
  const lowConf =
    typeof conf === "number" && conf > 0 && conf < 0.6 && Boolean(local);
  const display = formatAs === "phone" && local ? formatPhone(local) : local;

  if (type === "textarea") {
    return (
      <textarea
        value={display}
        placeholder={placeholder}
        onChange={(e) => scheduleSave(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        rows={3}
        className={cn(className, lowConf && "invalid-soft")}
      />
    );
  }

  return (
    <input
      type={type ?? "text"}
      value={display}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => scheduleSave(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(className, lowConf && "invalid-soft")}
      title={lowConf ? `Low confidence (${Math.round((conf ?? 0) * 100)}%)` : undefined}
    />
  );
}
