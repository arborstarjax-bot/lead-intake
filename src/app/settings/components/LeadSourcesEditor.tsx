"use client";

import { useMemo, useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { inputCls } from "../settings-helpers";

export function LeadSourcesEditor({
  sources,
  onChange,
}: {
  sources: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const list = useMemo(() => sources.filter((s) => s.trim().length > 0), [sources]);

  function add() {
    const name = draft.trim();
    if (!name) return;
    if (list.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...list, name]);
    setDraft("");
  }

  function remove(name: string) {
    onChange(list.filter((s) => s !== name));
  }

  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2"
            >
              <GripVertical className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" />
              <span className="text-sm flex-1">{name}</span>
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                className="text-[var(--muted)] hover:text-red-500 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-stretch gap-2">
        <input
          className={inputCls}
          value={draft}
          placeholder="Add a lead source"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 h-11 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-95 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
}
