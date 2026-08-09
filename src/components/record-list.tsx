import { Link } from "@tanstack/react-router";
import { Wrench, BookOpen, ChatCenteredDots, Scales, Cross, FileText } from "@phosphor-icons/react";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { RECORD_TYPE_LABEL } from "@/lib/types";

export function recordHref(r: { id: string; recordType: RecordType }): string {
  return `/${plural(r.recordType)}/${r.id}`;
}

export function plural(t: RecordType): string {
  if (t === "repository") return "repositories";
  if (t === "document") return "documents";
  return `${t}s`;
}

export function TypeIcon({ type, size = 16 }: { type: RecordType; size?: number }) {
  const Cmp =
    type === "tool"
      ? Wrench
      : type === "repository"
        ? BookOpen
        : type === "conversation"
          ? ChatCenteredDots
          : type === "decision"
            ? Scales
            : FileText;
  return <Cmp size={size} className="text-[color:var(--brass)]" />;
}

// Tombstone marker is used only for Buried and Grok-tier cursed tools.
export function TombstoneIfBuried({ r }: { r: ArchiveRecord }) {
  if (r.recordType !== "tool") return null;
  const s = r.recordData.status;
  if (s !== "Buried" && s !== "Grok-tier cursed") return null;
  return (
    <span title={s} className="inline-flex items-center text-[color:var(--muted-foreground)]">
      <Cross size={16} weight="fill" />
    </span>
  );
}

export function RecordRow({ r, showType }: { r: ArchiveRecord; showType?: boolean }) {
  return (
    <Link
      to={recordHref(r)}
      className="block border-b border-border px-3 py-3 transition-colors last:border-0 hover:bg-[color:var(--record-hover)]"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <TypeIcon type={r.recordType} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-sm font-medium text-foreground line-clamp-2 sm:truncate">
              {r.title}
            </div>
            <span className="shrink-0">
              <TombstoneIfBuried r={r} />
            </span>
          </div>
          {showType ? (
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {RECORD_TYPE_LABEL[r.recordType]}
            </div>
          ) : null}
          {r.summary ? (
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground break-words">
              {r.summary}
            </div>
          ) : null}
          {r.tags.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-sm bg-[color:var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground break-all"
                >
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function RecordList({ items, showType }: { items: ArchiveRecord[]; showType?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No records.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card">
      {items.map((r) => (
        <RecordRow key={r.id} r={r} showType={showType} />
      ))}
    </div>
  );
}
