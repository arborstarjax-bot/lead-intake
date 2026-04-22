"use client";

import { useEffect, useRef, useState } from "react";
import { inputCls } from "../settings-helpers";

/**
 * Number input that lets the user fully clear the value while typing,
 * then clamps into [min, max] on blur.
 *
 * UX contract:
 *   - The *visible* draft is free-form (can be empty, can be out of
 *     range) so the user can clear the field and type a new value
 *     without the clamp snapping them back to the minimum mid-edit.
 *   - The *parent* state is kept fresh on every keystroke (clamped to
 *     [min, max]) so the surrounding autosave machinery
 *     (visibilitychange / pagehide / unmount → flush) never loses the
 *     edit if the user backgrounds the tab before blurring.
 *   - On blur we re-render the draft as the clamped value for
 *     feedback.
 */
export function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const ref = useRef<HTMLInputElement | null>(null);

  // Keep local draft in sync if the saved value changes out-of-band
  // (e.g. PUT response normalizes the value) and we are not actively
  // editing — `document.activeElement` dodges clobbering a mid-edit.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) return;
    setDraft(String(value));
  }, [value]);

  function commit(raw: string) {
    if (raw.trim() === "") return; // mid-edit; don't clobber pending.current
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <input
      ref={ref}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={5}
      className={inputCls}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Keep the parent's pending patch fresh so a tab switch or
        // pagehide before blur still persists the edit.
        commit(raw);
      }}
      onBlur={() => {
        const n = Number(draft);
        const clamped = Number.isFinite(n)
          ? Math.max(min, Math.min(max, Math.round(n)))
          : min;
        setDraft(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
    />
  );
}
