import { useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { RECORD_TYPE_LABEL, RECORD_TYPES } from "@/lib/types";
import { TypeIcon } from "./record-list";

export function RecordPicker({
  all,
  currentId,
  value,
  onChange,
}: {
  all: ArchiveRecord[];
  currentId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");

  const selected = useMemo(() => {
    const set = new Set(value);
    return all.filter((r) => set.has(r.id));
  }, [all, value]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all
      .filter((r) => r.id !== currentId)
      .filter((r) => (typeFilter === "all" ? true : r.recordType === typeFilter))
      .filter((r) => (query ? r.title.toLowerCase().includes(query) : true))
      .slice(0, 30);
  }, [all, q, typeFilter, currentId]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title…"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as RecordType | "all")}
          className="rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground"
        >
          <option value="all">All types</option>
          {RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {RECORD_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {selected.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-sm bg-[color:var(--burgundy-muted)] px-2 py-1 text-xs text-foreground"
            >
              <TypeIcon type={r.recordType} size={12} />
              <span className="max-w-[220px] truncate">{r.title}</span>
              <button
                type="button"
                aria-label={`Remove link to ${r.title}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => toggle(r.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <ul className="mt-3 max-h-[240px] overflow-auto rounded-md border border-border">
        {results.length === 0 ? (
          <li className="p-3 text-center text-xs text-muted-foreground">No matches.</li>
        ) : (
          results.map((r) => {
            const checked = value.includes(r.id);
            return (
              <li key={r.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-[color:var(--record-hover)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(r.id)}
                    className="h-4 w-4 accent-[color:var(--primary)]"
                  />
                  <TypeIcon type={r.recordType} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.title}</span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {r.recordType}
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
