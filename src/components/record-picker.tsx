import { useMemo, useState } from "react";
import { CaretDown, CaretUp, LinkSimple, X } from "@phosphor-icons/react";
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
  const [expanded, setExpanded] = useState(false);

  const selected = useMemo(() => {
    const set = new Set(value);
    return all.filter((r) => set.has(r.id));
  }, [all, value]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return [...all]
      .filter((r) => r.id !== currentId)
      .filter((r) => (typeFilter === "all" ? true : r.recordType === typeFilter))
      .filter((r) => (query ? r.title.toLowerCase().includes(query) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
      .slice(0, 30);
  }, [all, q, typeFilter, currentId]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-[color:var(--record-hover)]"
        aria-expanded={expanded}
      >
        <LinkSimple size={18} className="text-[color:var(--brass)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-foreground">
            {value.length
              ? `${value.length} connected record${value.length === 1 ? "" : "s"}`
              : "Add connected records"}
          </span>
          <span className="block text-xs text-muted-foreground">
            Search recent records or filter by type.
          </span>
        </span>
        {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
      </button>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-3">
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
                className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => toggle(r.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t border-border p-3">
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

          <p className="mt-3 text-xs text-muted-foreground">
            {q.trim() ? "Search results" : "Recently updated"}
          </p>
          <ul className="mt-2 max-h-[240px] overflow-auto rounded-md border border-border">
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
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {r.title}
                      </span>
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
      ) : null}
    </div>
  );
}
