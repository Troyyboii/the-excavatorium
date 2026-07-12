import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PencilSimple, DownloadSimple, Copy } from "@phosphor-icons/react";
import type { ArchiveLink, ArchiveRecord } from "@/lib/types";
import { RECORD_TYPE_LABEL } from "@/lib/types";
import { plural, recordHref, TypeIcon, TombstoneIfBuried } from "./record-list";
import { PageHeader, Toast } from "./page-parts";
import { download, toMarkdown } from "@/lib/format";

function editRoute(record: ArchiveRecord) {
  switch (record.recordType) {
    case "tool":
      return { to: "/tools/$id/edit" as const, params: { id: record.id } };
    case "repository":
      return { to: "/repositories/$id/edit" as const, params: { id: record.id } };
    case "conversation":
      return { to: "/conversations/$id/edit" as const, params: { id: record.id } };
    case "decision":
      return { to: "/decisions/$id/edit" as const, params: { id: record.id } };
  }
}

export function RecordDetail({
  record,
  allRecords,
  allLinks,
  byId,
}: {
  record: ArchiveRecord;
  allRecords: ArchiveRecord[];
  allLinks: ArchiveLink[];
  byId: Map<string, ArchiveRecord>;
}) {
  const [toast, setToast] = useState<string | null>(null);

  const linked = allLinks
    .filter((l) => l.sourceId === record.id)
    .map((l) => byId.get(l.targetId))
    .filter((r): r is ArchiveRecord => !!r);
  const backlinked = allLinks
    .filter((l) => l.targetId === record.id)
    .map((l) => byId.get(l.sourceId))
    .filter((r): r is ArchiveRecord => !!r);

  function onExport() {
    const md = toMarkdown(record, linked, backlinked, byId);
    download(md.filename, md.body, "text/markdown;charset=utf-8");
    setToast("Markdown exported");
  }

  return (
    <div>
      <PageHeader
        title={record.title}
        description={RECORD_TYPE_LABEL[record.recordType]}
        action={
          <>
            <button
              type="button"
              onClick={onExport}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)]"
            >
              <DownloadSimple size={16} /> Export as Markdown
            </button>
            <Link
              {...editRoute(record)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary)]/90"
            >
              <PencilSimple size={16} /> Edit
            </Link>
          </>
        }
      />

      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <TypeIcon type={record.recordType} />
        <span>{RECORD_TYPE_LABEL[record.recordType]}</span>
        <TombstoneIfBuried r={record} />
        {record.isExample ? (
          <span className="rounded-sm border border-[color:var(--brass-muted)] px-1 font-mono text-[10px] uppercase text-[color:var(--brass)]">
            seed
          </span>
        ) : null}
        <span className="ml-auto font-mono">updated {record.updatedAt.slice(0, 10)}</span>
      </div>

      {record.tags.length ? (
        <div className="mb-4 flex flex-wrap gap-1">
          {record.tags.map((t) => (
            <span
              key={t}
              className="rounded-sm bg-[color:var(--secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      {record.summary ? (
        <p className="mb-6 whitespace-pre-wrap text-sm text-foreground">{record.summary}</p>
      ) : null}

      <div className="space-y-6">
        {record.recordType === "tool" ? <ToolDetail r={record} byId={byId} /> : null}
        {record.recordType === "repository" ? <RepositoryDetail r={record} /> : null}
        {record.recordType === "conversation" ? (
          <ConversationDetail r={record} onToast={setToast} />
        ) : null}
        {record.recordType === "decision" ? <DecisionDetail r={record} byId={byId} /> : null}

        <LinkedSection title="Linked records" items={linked} />
        <LinkedSection title="Backlinks" items={backlinked} />
      </div>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function DlSection({
  heading,
  entries,
}: {
  heading: string;
  entries: [string, string | null | undefined][];
}) {
  const visible = entries.filter(([, v]) => v && v.toString().trim() !== "");
  if (visible.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-6">
      <h2 className="mb-3 font-serif text-lg text-foreground">{heading}</h2>
      <dl className="space-y-3">
        {visible.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ToolDetail({
  r,
  byId,
}: {
  r: ArchiveRecord & { recordType: "tool" };
  byId: Map<string, ArchiveRecord>;
}) {
  const d = r.recordData;
  const replacement = d.replacementToolId ? byId.get(d.replacementToolId) : null;
  return (
    <>
      <DlSection
        heading="Overview"
        entries={[
          ["Category", d.category],
          ["Status", d.status],
          ["Last reviewed", d.lastReviewed],
          ["Replacement", replacement ? replacement.title : null],
        ]}
      />
      <DlSection
        heading="Judgment"
        entries={[
          ["What caught my eye", d.whatCaughtMyEye],
          ["What it promised", d.whatItPromised],
          ["What actually happened", d.whatActuallyHappened],
          ["What worked", d.whatWorked],
          ["What failed", d.whatFailed],
          ["Why I kept or stopped using it", d.whyIKeptOrStoppedUsingIt],
          ["Revisit condition", d.revisitCondition],
          ["Final verdict", d.finalVerdict],
        ]}
      />
    </>
  );
}

function RepositoryDetail({ r }: { r: ArchiveRecord & { recordType: "repository" } }) {
  const d = r.recordData;
  return (
    <>
      <DlSection
        heading="Overview"
        entries={[
          ["GitHub URL", d.githubUrl],
          ["Recommended action", d.recommendedAction ?? "Awaiting verdict"],
          ["Last reviewed", d.lastReviewed],
        ]}
      />
      <DlSection
        heading="Ratings"
        entries={[
          ["Complexity", d.complexity],
          ["Risk", d.risk],
          ["Integration cost", d.integrationCost],
          ["Immediate usefulness", d.immediateUsefulness],
          ["Long-term value", d.longTermValue],
        ]}
      />
      <DlSection
        heading="Judgment"
        entries={[
          ["What caught my eye", d.whatCaughtMyEye],
          ["What it claims", d.whatItClaims],
          ["What it actually does", d.whatItActuallyDoes],
          ["Maintenance impression", d.maintenanceImpression],
          ["Final verdict", d.finalVerdict],
        ]}
      />
    </>
  );
}

function ConversationDetail({
  r,
  onToast,
}: {
  r: ArchiveRecord & { recordType: "conversation" };
  onToast: (m: string) => void;
}) {
  const d = r.recordData;
  const [showRaw, setShowRaw] = useState(false);
  return (
    <>
      <DlSection
        heading="Overview"
        entries={[
          ["Conversation date", d.conversationDate],
          ["Project route", d.projectRoute],
        ]}
      />
      <DlSection
        heading="Judgment"
        entries={[
          ["High-signal findings", d.highSignalFindings],
          ["Decisions made", d.decisionsMade],
          ["Open loops", d.openLoops],
          ["Reusable prompts", d.reusablePrompts],
          ["Memory candidates", d.memoryCandidates],
        ]}
      />
      <section className="rounded-lg border border-border bg-card p-4 md:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-lg text-foreground">Raw conversation text</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {d.rawConversationText.length.toLocaleString()} chars
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(d.rawConversationText).then(() => onToast("Copied"));
              }}
              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
            >
              <Copy size={14} /> Copy
            </button>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
            >
              {showRaw ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        {showRaw ? (
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
            {d.rawConversationText || "(empty)"}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Collapsed by default. Expand on demand.</p>
        )}
      </section>
    </>
  );
}

function DecisionDetail({
  r,
  byId,
}: {
  r: ArchiveRecord & { recordType: "decision" };
  byId: Map<string, ArchiveRecord>;
}) {
  const d = r.recordData;
  const supersedes = d.supersedesDecisionId ? byId.get(d.supersedesDecisionId) : null;
  return (
    <>
      <DlSection
        heading="Overview"
        entries={[
          ["Decision date", d.decisionDate],
          ["Status", d.status],
          ["Confidence", d.confidence],
          ["Supersedes", supersedes ? supersedes.title : null],
        ]}
      />
      <DlSection
        heading="Judgment"
        entries={[
          ["Reason", d.reason],
          ["Trigger", d.trigger],
          ["What would change my mind", d.whatWouldChangeMyMind],
        ]}
      />
    </>
  );
}

function LinkedSection({ title, items }: { title: string; items: ArchiveRecord[] }) {
  if (items.length === 0) return null;
  const groups = {
    tool: items.filter((r) => r.recordType === "tool"),
    repository: items.filter((r) => r.recordType === "repository"),
    conversation: items.filter((r) => r.recordType === "conversation"),
    decision: items.filter((r) => r.recordType === "decision"),
  };
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-6">
      <h2 className="mb-3 font-serif text-lg text-foreground">{title}</h2>
      <div className="space-y-3">
        {(Object.keys(groups) as (keyof typeof groups)[]).map((key) => {
          const list = groups[key];
          if (list.length === 0) return null;
          return (
            <div key={key}>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {RECORD_TYPE_LABEL[key]}
              </div>
              <ul className="space-y-1">
                {list.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={recordHref(r)}
                      className="inline-flex items-center gap-2 text-sm text-foreground hover:text-[color:var(--brass)]"
                    >
                      <TypeIcon type={r.recordType} />
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
