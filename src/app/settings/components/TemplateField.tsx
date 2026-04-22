"use client";

import { useRef } from "react";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/templates";
import { inputCls, textareaCls } from "../settings-helpers";

/**
 * Template editor: a textarea (or single-line input when rows=1) plus a
 * row of tappable placeholder chips that drop `{firstName}` etc. at the
 * current cursor position. Avoids forcing the user to type curly braces
 * on a phone keyboard.
 */
export function TemplateField({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // Remember the last cursor position even after the textarea blurs so
  // that tapping a chip still inserts at the right spot on mobile.
  const caretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  function rememberCaret() {
    const el = ref.current;
    if (!el) return;
    caretRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }

  function insert(token: string) {
    const el = ref.current;
    const { start, end } = caretRef.current;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Restore focus + caret after React re-renders so the user can keep
    // typing. We also remember the new caret for the next chip tap.
    const caret = start + token.length;
    caretRef.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // Some input types (e.g. type=email) don't support setSelectionRange.
      }
    });
  }

  const common = {
    value,
    placeholder: "Leave blank to use the built-in default",
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value);
    },
    onBlur: rememberCaret,
    onKeyUp: rememberCaret,
    onClick: rememberCaret,
    onSelect: rememberCaret,
  };

  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--muted)] mb-1">{label}</div>
      {rows > 1 ? (
        <textarea
          {...common}
          ref={(el) => {
            ref.current = el;
          }}
          className={textareaCls}
          rows={rows}
        />
      ) : (
        <input
          {...common}
          ref={(el) => {
            ref.current = el;
          }}
          className={inputCls}
        />
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {TEMPLATE_PLACEHOLDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => insert(`{${p}}`)}
            // Prevent the textarea from losing focus (and thus losing its
            // selection) before we insert on mousedown on desktop.
            onMouseDown={(e) => e.preventDefault()}
            className="inline-flex items-center h-7 px-2.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[11px] font-mono text-[var(--fg)] hover:bg-slate-200 active:scale-[0.98]"
          >
            {`{${p}}`}
          </button>
        ))}
      </div>
    </label>
  );
}
