import { useMemo, useState } from "react";
import { CaretDown, CaretUp, FileText, X } from "@phosphor-icons/react";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { RECORD_TYPE_LABEL, RECORD_TYPES } from "@/lib/types";
import { CASE_ARCHIVE_SCOPE_MAX_RECORDS } from "@/lib/custodian-types";
import { TypeIcon } from "../record-list";

export function CaseScopePicker({
  all,
  value,
  onChange,
  disabled = false,
}: {
  all: readonly ArchiveRecord[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const selectedIds = useMemo(() => new Set(value), [value]);
  const selected = useMemo(
    () =>
      value.map((id) => all.find((record) => record.id === id)).filter(Boolean) as ArchiveRecord[],
    [all, value],
  );
  const missingIds = useMemo(
    () => value.filter((id) => !all.some((record) => record.id === id)),
    [all, value],
  );
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-GB");
    return all
      .filter((record) => (typeFilter === "all" ? true : record.recordType === typeFilter))
      .filter((record) =>
        normalized
          ? record.title.toLocaleLowerCase().includes(normalized) ||
            record.id.toLocaleLowerCase().includes(normalized)
          : true,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
      .slice(0, 30);
  }, [all, query, typeFilter]);

  function toggle(recordId: string) {
    if (value.includes(recordId)) {
      onChange(value.filter((id) => id !== recordId));
      return;
    }
    if (value.length >= CASE_ARCHIVE_SCOPE_MAX_RECORDS) return;
    onChange([...value, recordId]);
  }

  return (
    <div className="min-w-0 border border-luminous-gold/30 bg-background">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-burgundy-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={expanded}
        aria-controls="case-archive-scope-picker"
      >
        <FileText size={18} className="shrink-0 text-luminous-gold" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-white-gold">
            {value.length
              ? `${value.length} archive record${value.length === 1 ? "" : "s"} selected`
              : "Select archive records"}
          </span>
          <span className="block text-xs text-muted-foreground">
            The Case Reading uses only these canonical records. Maximum{" "}
            {CASE_ARCHIVE_SCOPE_MAX_RECORDS}.
          </span>
        </span>
        {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
      </button>

      {selected.length || missingIds.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-luminous-gold/20 px-3 py-3">
          {selected.map((record) => (
            <span
              key={record.id}
              className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm bg-burgundy-muted/70 px-2 py-1 text-xs text-white-gold"
            >
              <TypeIcon type={record.recordType} size={12} />
              <span className="max-w-[220px] truncate">{record.title}</span>
              <button
                type="button"
                aria-label={`Remove archive record ${record.title}`}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-white-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                onClick={() => toggle(record.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {missingIds.map((recordId) => (
            <span
              key={recordId}
              className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm border border-risk/50 px-2 py-1 text-xs text-white-gold"
            >
              <span className="max-w-[220px] truncate font-mono">
                Unavailable record {recordId}
              </span>
              <button
                type="button"
                aria-label={`Remove unavailable archive record ${recordId}`}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-white-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                onClick={() => toggle(recordId)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div id="case-archive-scope-picker" className="border-t border-luminous-gold/20 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title…"
              aria-label="Search archive records"
              className="min-h-11 min-w-0 flex-1 border border-luminous-gold/30 bg-background px-3 py-2 text-sm text-white-gold outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-luminous-gold"
              disabled={disabled}
            />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as RecordType | "all")}
              aria-label="Filter archive records by type"
              className="min-h-11 border border-luminous-gold/30 bg-background px-2 py-2 text-sm text-white-gold outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
              disabled={disabled}
            >
              <option value="all">All types</option>
              {RECORD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {RECORD_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {query.trim() ? "Search results" : "Recently updated"} · {value.length}/
            {CASE_ARCHIVE_SCOPE_MAX_RECORDS} selected
          </p>
          <ul className="mt-2 max-h-[280px] overflow-auto border border-luminous-gold/20">
            {results.length === 0 ? (
              <li className="p-3 text-center text-xs text-muted-foreground">
                {all.length ? "No matching archive records." : "Archive records are unavailable."}
              </li>
            ) : (
              results.map((record) => {
                const checked = selectedIds.has(record.id);
                const atLimit = !checked && value.length >= CASE_ARCHIVE_SCOPE_MAX_RECORDS;
                return (
                  <li key={record.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-luminous-gold/15 px-3 py-2 last:border-0 hover:bg-burgundy-muted/25 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || atLimit}
                        onChange={() => toggle(record.id)}
                        className="h-4 w-4 accent-[color:var(--primary)]"
                      />
                      <TypeIcon type={record.recordType} />
                      <span className="min-w-0 flex-1 truncate text-sm text-white-gold">
                        {record.title}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {record.recordType}
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
