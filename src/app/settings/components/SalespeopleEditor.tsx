"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { inputCls } from "../settings-helpers";

export function SalespeopleEditor({
  roster,
  onChange,
}: {
  roster: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const list = useMemo(() => roster.filter((n) => n.trim().length > 0), [roster]);

  function add() {
    const name = draft.trim();
    if (!name) return;
    if (list.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...list, name]);
    setDraft("");
  }

  function remove(name: string) {
    onChange(list.filter((n) => n !== name));
  }

  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((name) => (
            <li
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 h-9 text-sm"
            >
              <span>{name}</span>
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                className="text-[var(--muted)] hover:text-[var(--fg)]"
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
          placeholder="Add a salesperson"
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
