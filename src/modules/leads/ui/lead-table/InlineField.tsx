"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead } from "@/modules/leads/model";
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
  onPatch: (p: Partial<Lead>) => void;
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
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    const patch: Partial<Lead> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patch as any)[field] = next === "" ? null : next;
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
        onBlur={flush}
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
      onBlur={flush}
      className={cn(className, lowConf && "invalid-soft")}
      title={lowConf ? `Low confidence (${Math.round((conf ?? 0) * 100)}%)` : undefined}
    />
  );
}
