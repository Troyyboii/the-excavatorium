import { useState, type KeyboardEvent } from "react";
import { X } from "@phosphor-icons/react";
import { normalizeTags } from "@/lib/format";

export function TagInput({
  value,
  onChange,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(next: string) {
    const merged = normalizeTags([...value, next]);
    onChange(merged);
    setDraft("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const t = draft.trim();
      if (t) commit(t);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-ring">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-sm bg-[color:var(--secondary)] px-1.5 py-0.5 font-mono text-xs text-foreground"
          >
            #{t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(value.filter((v) => v !== t))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            const t = draft.trim();
            if (t) commit(t);
          }}
          placeholder="Add tag…"
          className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm text-foreground outline-none"
        />
      </div>
    </div>
  );
}
