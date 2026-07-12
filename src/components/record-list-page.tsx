import { useMemo, useState } from "react";
import type {
  ArchiveRecord,
  Confidence,
  DecisionStatus,
  ProjectRoute,
  RatingLevel,
  RecordType,
  RepositoryAction,
  ToolStatus,
} from "@/lib/types";
import {
  CONFIDENCE_LEVELS,
  DECISION_STATUSES,
  PROJECT_ROUTES,
  RATING_LEVELS,
  REPOSITORY_ACTIONS,
  TOOL_STATUSES,
} from "@/lib/types";
import { RecordList } from "./record-list";
import { EmptyState, NewRecordButton, PageHeader } from "./page-parts";
import { plural } from "./record-list";

type Filters = {
  toolStatus?: ToolStatus | "";
  toolCategory?: string;
  repoAction?: RepositoryAction | "awaiting" | "";
  repoRisk?: RatingLevel | "";
  convRoute?: ProjectRoute | "";
  convHasLoops?: boolean;
  decisionStatus?: DecisionStatus | "";
  decisionConfidence?: Confidence | "";
  tag?: string;
};

export function RecordListPage({
  type,
  records,
}: {
  type: RecordType;
  records: ArchiveRecord[];
}) {
  const items = useMemo(() => records.filter((r) => r.recordType === type), [records, type]);
  const [f, setF] = useState<Filters>({});
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) for (const t of r.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (f.tag) out = out.filter((r) => r.tags.includes(f.tag!));
    if (type === "tool") {
      if (f.toolStatus) out = out.filter((r) => (r as ArchiveRecord & { recordType: "tool" }).recordData.status === f.toolStatus);
      if (f.toolCategory) {
        const c = f.toolCategory.toLowerCase();
        out = out.filter((r) => (r as ArchiveRecord & { recordType: "tool" }).recordData.category.toLowerCase().includes(c));
      }
    } else if (type === "repository") {
      if (f.repoAction) {
        out = out.filter((r) => {
          const a = (r as ArchiveRecord & { recordType: "repository" }).recordData.recommendedAction;
          if (f.repoAction === "awaiting") return a === null;
          return a === f.repoAction;
        });
      }
      if (f.repoRisk) out = out.filter((r) => (r as ArchiveRecord & { recordType: "repository" }).recordData.risk === f.repoRisk);
    } else if (type === "conversation") {
      if (f.convRoute) out = out.filter((r) => (r as ArchiveRecord & { recordType: "conversation" }).recordData.projectRoute === f.convRoute);
      if (f.convHasLoops) out = out.filter((r) => (r as ArchiveRecord & { recordType: "conversation" }).recordData.openLoops.trim() !== "");
    } else if (type === "decision") {
      if (f.decisionStatus) out = out.filter((r) => (r as ArchiveRecord & { recordType: "decision" }).recordData.status === f.decisionStatus);
      if (f.decisionConfidence) out = out.filter((r) => (r as ArchiveRecord & { recordType: "decision" }).recordData.confidence === f.decisionConfidence);
    }
    return [...out].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  }, [items, f, type]);

  const label =
    type === "tool" ? "Tools" : type === "repository" ? "Repositories" : type === "conversation" ? "Conversations" : "Decisions";
  const singular =
    type === "tool" ? "tool" : type === "repository" ? "repository" : type === "conversation" ? "conversation" : "decision";
  const hasActive = Object.values(f).some((v) => v !== undefined && v !== "" && v !== false);

  return (
    <div>
      <PageHeader
        title={label}
        description={`${items.length} record${items.length === 1 ? "" : "s"}.`}
        action={<NewRecordButton to={`/${plural(type)}/new`} label={`New ${singular}`} />}
      />

      <div className="mb-4 rounded-md border border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {type === "tool" ? (
            <>
              <FilterSelect
                label="Status"
                value={f.toolStatus ?? ""}
                onChange={(v) => setF({ ...f, toolStatus: v as ToolStatus | "" })}
                options={TOOL_STATUSES}
              />
              <FilterInput
                label="Category"
                value={f.toolCategory ?? ""}
                onChange={(v) => setF({ ...f, toolCategory: v })}
              />
            </>
          ) : null}
          {type === "repository" ? (
            <>
              <FilterSelect
                label="Action"
                value={f.repoAction ?? ""}
                onChange={(v) => setF({ ...f, repoAction: v as RepositoryAction | "awaiting" | "" })}
                options={["awaiting", ...REPOSITORY_ACTIONS]}
                labels={{ awaiting: "Awaiting verdict" }}
              />
              <FilterSelect
                label="Risk"
                value={f.repoRisk ?? ""}
                onChange={(v) => setF({ ...f, repoRisk: v as RatingLevel | "" })}
                options={RATING_LEVELS}
              />
            </>
          ) : null}
          {type === "conversation" ? (
            <>
              <FilterSelect
                label="Route"
                value={f.convRoute ?? ""}
                onChange={(v) => setF({ ...f, convRoute: v as ProjectRoute | "" })}
                options={PROJECT_ROUTES}
              />
              <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={!!f.convHasLoops}
                  onChange={(e) => setF({ ...f, convHasLoops: e.target.checked })}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                Has open loops
              </label>
            </>
          ) : null}
          {type === "decision" ? (
            <>
              <FilterSelect
                label="Status"
                value={f.decisionStatus ?? ""}
                onChange={(v) => setF({ ...f, decisionStatus: v as DecisionStatus | "" })}
                options={DECISION_STATUSES}
              />
              <FilterSelect
                label="Confidence"
                value={f.decisionConfidence ?? ""}
                onChange={(v) => setF({ ...f, decisionConfidence: v as Confidence | "" })}
                options={CONFIDENCE_LEVELS}
              />
            </>
          ) : null}
          <FilterSelect
            label="Tag"
            value={f.tag ?? ""}
            onChange={(v) => setF({ ...f, tag: v })}
            options={allTags}
          />
          {hasActive ? (
            <button
              type="button"
              onClick={() => setF({})}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:ml-auto sm:w-auto sm:justify-start"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? `No ${label.toLowerCase()} yet.` : "No records match the current filters."}
          hint={items.length === 0 ? `Create the first ${singular} from the button above.` : undefined}
        />
      ) : (
        <RecordList items={filtered} />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  labels?: Record<string, string>;
}) {
  return (
    <label className="inline-flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground sm:w-auto">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent py-1 pr-2 text-sm outline-none"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{labels?.[o] ?? o}</option>
        ))}
      </select>
    </label>
  );
}

function FilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground sm:w-auto">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
      />
    </label>
  );
}
