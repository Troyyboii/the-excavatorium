import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { ArchiveLink, ArchiveRecord, DecisionRecord } from "@/lib/types";
import { RECORD_TYPE_LABEL } from "@/lib/types";
import { recordHref } from "./record-list";
import { Toast } from "./page-parts";
import { CryptIcon, type CryptGlyph } from "./crypt-icon";
import { CustodianLine, CustodianPortrait } from "./custodian/custodian-presence";
import { download, toMarkdown } from "@/lib/format";
import { formatArchiveDate } from "@/lib/date-format";
import {
  custodianReadingLine,
  supersessionChain,
  type SupersessionInvalidity,
} from "@/lib/record-reading";
import { RECORD_KIND_SIGN, recordStanding, STANDING_TONE_CLASS } from "@/lib/record-standing";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing, useCustodianRecordContext } from "@/lib/custodian";
import { RecordEvidenceReader } from "./custodian/record-evidence-reader";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]";
const CANDLE = "text-[color:var(--candlelight)]";
const QUIET_BUTTON = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-[color:var(--mortar-strong)] px-3.5 text-base text-foreground transition-colors hover:border-[color:var(--candlelight)]",
  FOCUS_RING,
);
const PANEL = "border border-border bg-card p-4 md:p-6";

const CHAMBER_NAME: Record<ArchiveRecord["recordType"], string> = {
  document: "Documents",
  tool: "Tools",
  conversation: "Conversations",
  decision: "Decisions",
  repository: "Repositories",
};

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
    case "document":
      return { to: "/documents/$id/edit" as const, params: { id: record.id } };
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
  const online = useOnlineStatus();
  const contextQuery = useCustodianRecordContext(record.id, online);

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

  const kind = RECORD_KIND_SIGN[record.recordType];
  const standing = recordStanding(record);
  const chain = supersessionChain(record, allRecords, byId);
  const canExamine = record.recordType === "decision";
  const findingCount = contextQuery.data ? contextQuery.data.findings.length : undefined;

  return (
    <div className="mx-auto max-w-[1216px]">
      <nav aria-label="Breadcrumb" className="mb-4 text-[0.9375rem]">
        <ol className="flex flex-wrap items-center gap-2 text-[color:var(--ash)]">
          <li>
            <Link to="/archive" className={cn("text-foreground hover:underline", FOCUS_RING)}>
              Archive
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              to="/archive"
              search={{ type: record.recordType }}
              className={cn("hover:text-foreground hover:underline", FOCUS_RING)}
            >
              {CHAMBER_NAME[record.recordType]}
            </Link>
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-5 md:flex-row md:items-start">
        <span
          className={cn(
            "flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-current md:h-[92px] md:w-[92px]",
            kind.toneClass,
          )}
        >
          <CryptIcon glyph={kind.glyph} size={40} className="md:h-12 md:w-12" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-serif text-[2.25rem] leading-[1.1] text-foreground md:text-5xl">
            {record.title}
          </h1>
          <p className="sr-only">{RECORD_TYPE_LABEL[record.recordType]}</p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Standing">
            <Chip glyph={standing.glyph} toneClass={STANDING_TONE_CLASS[standing.tone]}>
              {standing.label}
            </Chip>
            {record.recordType === "decision" ? (
              <>
                <Chip glyph="candle" toneClass={CANDLE}>
                  {record.recordData.confidence} confidence
                </Chip>
                <Chip glyph="hourglass" toneClass="text-[color:var(--mist)]">
                  Decided {formatArchiveDate(record.recordData.decisionDate)}
                </Chip>
              </>
            ) : (
              <Chip glyph="hourglass" toneClass="text-[color:var(--mist)]">
                Updated {formatArchiveDate(record.updatedAt)}
              </Chip>
            )}
          </ul>
        </div>
        <div className="flex gap-2 md:shrink-0">
          <button
            type="button"
            onClick={onExport}
            aria-label="Export as Markdown"
            className={QUIET_BUTTON}
          >
            <CryptIcon glyph="urn" size={20} className="text-[color:var(--mist)]" />
            Export
          </button>
          <Link {...editRoute(record)} className={QUIET_BUTTON}>
            <CryptIcon glyph="quill" size={20} className="text-[color:var(--mist)]" />
            Edit
          </Link>
        </div>
      </header>

      <SupersessionChain
        replaces={chain.replaces}
        replacedBy={chain.replacedBy}
        invalid={chain.invalid}
      />

      <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
        <div className="min-w-0 space-y-6">
          {record.summary ? (
            <p className="whitespace-pre-wrap text-lg leading-8 text-foreground">
              {record.summary}
            </p>
          ) : null}
          {record.tags.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Tags">
              {record.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full border border-border px-2.5 py-0.5 text-sm text-muted-foreground"
                >
                  #{t}
                </li>
              ))}
            </ul>
          ) : null}

          {record.recordType === "tool" ? <ToolDetail r={record} byId={byId} /> : null}
          {record.recordType === "repository" ? <RepositoryDetail r={record} /> : null}
          {record.recordType === "conversation" ? (
            <ConversationDetail r={record} onToast={setToast} />
          ) : null}
          {record.recordType === "decision" ? <DecisionDetail r={record} /> : null}
          {record.recordType === "document" ? (
            <DocumentDetail r={record} onToast={setToast} />
          ) : null}
        </div>

        <div className="min-w-0 space-y-8">
          <section
            aria-labelledby="custodian-reading-panel"
            className="border border-[color:var(--mortar-strong)] bg-card p-5"
          >
            <div className="flex items-center gap-4">
              <CustodianPortrait size={68} ring="candle" />
              <h2
                id="custodian-reading-panel"
                className="font-serif text-[1.625rem] text-foreground"
              >
                The Custodian’s reading
              </h2>
            </div>
            <CustodianLine size="sm" className="mt-4">
              {custodianReadingLine(standing.kind, findingCount, canExamine)}
            </CustodianLine>
            {canExamine ? (
              <Link
                to="/cases"
                search={{ decision: record.id }}
                className={cn(
                  "mt-5 flex min-h-12 items-center justify-center gap-2.5 rounded-sm bg-[color:var(--candlelight)] px-4 text-base font-bold text-[color:var(--candle-ink)] transition-colors hover:bg-[color:var(--moonbone)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--moonbone)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              >
                <CryptIcon glyph="key" size={20} />
                Ask the Custodian to examine
              </Link>
            ) : null}
          </section>

          <BoundTo linked={linked} backlinked={backlinked} />
        </div>
      </div>

      <details className="group mt-10 border-t border-border pt-5">
        <summary
          className={cn(
            "inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm pr-2 text-lg text-foreground [&::-webkit-details-marker]:hidden",
            FOCUS_RING,
          )}
        >
          <CryptIcon glyph="scroll" size={20} className="text-[color:var(--mist)]" />
          Provenance and Custodian evidence
          <span className="text-base text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-base text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="mt-5 max-w-3xl">
          <RecordEvidenceReader
            record={record}
            context={contextQuery.data}
            linkedRecordCount={linked.length}
            backlinkCount={backlinked.length}
            loading={online && contextQuery.isPending}
            online={online}
            foundationPending={isCustodianFoundationMissing(contextQuery.error)}
            error={contextQuery.error instanceof Error ? contextQuery.error.message : null}
          />
        </div>
      </details>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function Chip({
  glyph,
  toneClass,
  children,
}: {
  glyph: CryptGlyph;
  toneClass: string;
  children: ReactNode;
}) {
  return (
    <li className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--mortar-strong)] pl-2.5 pr-3.5 text-[0.9375rem] text-foreground">
      <CryptIcon glyph={glyph} size={18} className={toneClass} />
      {children}
    </li>
  );
}

function SupersessionChain({
  replaces,
  replacedBy,
  invalid,
}: {
  replaces: DecisionRecord | null;
  replacedBy: DecisionRecord[];
  invalid: SupersessionInvalidity | null;
}) {
  if (invalid) {
    return (
      <div className="mt-6 border border-[color:var(--ember)] bg-card px-4 py-3 text-base text-foreground">
        <p className="font-medium text-[color:var(--ember)]">Invalid supersession chain</p>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">
          {invalid.kind === "self-reference"
            ? "This decision names itself as the record it replaces. The replacement ancestry is not shown."
            : "Saved replacement pointers form a cycle. The contradictory ancestry is not shown."}
        </p>
        <p className="mt-2 break-all font-mono text-[0.8125rem] text-[color:var(--ash)]">
          {invalid.path.join(" → ")}
        </p>
      </div>
    );
  }
  if (!replaces && !replacedBy.length) return null;
  const link = (target: DecisionRecord, emphasised: boolean) => (
    <Link
      key={target.id}
      to={recordHref(target)}
      className={cn(
        "inline-flex min-h-12 items-center gap-2.5 rounded-sm border px-4 text-base text-foreground transition-colors",
        emphasised
          ? "border-[color:var(--candlelight)] bg-card hover:bg-accent"
          : "border-[color:var(--mortar-strong)] hover:border-[color:var(--candlelight)]",
        FOCUS_RING,
      )}
    >
      <CryptIcon glyph="gravestone" size={20} className={CANDLE} />
      {target.title}, {formatArchiveDate(target.recordData.decisionDate)}
    </Link>
  );
  const self = (
    <span className="inline-flex min-h-12 items-center gap-2.5 rounded-sm border border-border bg-[color:var(--vault-deep)] px-4 text-base text-[color:var(--mist)]">
      <CryptIcon glyph="toppled" size={20} className="text-[color:var(--ash)]" />
      This decision
    </span>
  );
  return (
    <div className="mt-6 space-y-3">
      {replacedBy.length ? (
        <p className="flex flex-wrap items-center gap-3">
          {self}
          <span className="text-[0.9375rem] text-muted-foreground">was replaced by</span>
          {replacedBy.map((target) => link(target, true))}
        </p>
      ) : null}
      {replaces ? (
        <p className="flex flex-wrap items-center gap-3">
          <span className="text-[0.9375rem] text-muted-foreground">This decision replaced</span>
          {link(replaces, false)}
        </p>
      ) : null}
    </div>
  );
}

function BoundTo({ linked, backlinked }: { linked: ArchiveRecord[]; backlinked: ArchiveRecord[] }) {
  const outgoing = new Set(linked.map((item) => item.id));
  const items = [
    ...linked.map((item) => ({ item, incoming: false })),
    ...backlinked
      .filter((item) => !outgoing.has(item.id))
      .map((item) => ({ item, incoming: true })),
  ];
  return (
    <section aria-labelledby="bound-to-heading">
      <h2
        id="bound-to-heading"
        className="flex items-center gap-2.5 font-serif text-[1.5rem] text-foreground"
      >
        <CryptIcon glyph="chains" size={22} className="text-[color:var(--mist)]" />
        Bound to
      </h2>
      {items.length ? (
        <ul className="mt-2">
          {items.map(({ item, incoming }) => {
            const sign = RECORD_KIND_SIGN[item.recordType];
            return (
              <li key={item.id} className="border-b border-border">
                <Link
                  to={recordHref(item)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 px-1 py-2 text-base text-foreground hover:text-[color:var(--candlelight)]",
                    FOCUS_RING,
                  )}
                >
                  <CryptIcon glyph={sign.glyph} size={22} className={sign.toneClass} />
                  <span className="min-w-0 flex-1 break-words">{item.title}</span>
                  {incoming ? (
                    <span className="shrink-0 text-sm text-[color:var(--ash)]">links here</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-base text-muted-foreground">Not bound to any other record yet.</p>
      )}
    </section>
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
    <section className={PANEL}>
      <h2 className="mb-4 font-serif text-[1.5rem] text-foreground">{heading}</h2>
      <dl className="space-y-4">
        {visible.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[0.9375rem] font-medium text-[color:var(--mist)]">{k}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-base leading-7 text-foreground">
              {v}
            </dd>
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
      <section className={PANEL}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-[1.5rem] text-foreground">Raw conversation text</h2>
          <span className="text-sm text-muted-foreground">
            {d.rawConversationText.length.toLocaleString()} characters
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(d.rawConversationText).then(() => onToast("Copied"));
              }}
              className={QUIET_BUTTON}
            >
              Copy
            </button>
            <button
              type="button"
              aria-expanded={showRaw}
              onClick={() => setShowRaw((v) => !v)}
              className={QUIET_BUTTON}
            >
              {showRaw ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        {showRaw ? (
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-background p-3 font-mono text-sm text-foreground">
            {d.rawConversationText || "(empty)"}
          </pre>
        ) : (
          <p className="text-base text-muted-foreground">Collapsed by default. Expand on demand.</p>
        )}
      </section>
    </>
  );
}

const DECISION_FIELDS: readonly {
  key: "reason" | "trigger" | "whatWouldChangeMyMind";
  heading: string;
  glyph: CryptGlyph;
  toneClass: string;
}[] = [
  { key: "reason", heading: "Why", glyph: "scroll", toneClass: "text-[color:var(--parchment)]" },
  {
    key: "trigger",
    heading: "What triggered it",
    glyph: "skull",
    toneClass: "text-[color:var(--ember)]",
  },
  {
    key: "whatWouldChangeMyMind",
    heading: "What would change my mind",
    glyph: "key",
    toneClass: CANDLE,
  },
];

function DecisionDetail({ r }: { r: ArchiveRecord & { recordType: "decision" } }) {
  const d = r.recordData;
  const fields = DECISION_FIELDS.filter((field) => d[field.key].trim());
  if (!fields.length) {
    return <p className="text-base text-muted-foreground">No reasons are recorded yet.</p>;
  }
  return (
    <div className="space-y-6">
      {fields.map((field) => (
        <section key={field.key} className="grid grid-cols-[44px_minmax(0,1fr)] gap-4">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--mortar-strong)]",
              field.toneClass,
            )}
          >
            <CryptIcon glyph={field.glyph} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-serif text-[1.625rem] leading-tight text-foreground">
              {field.heading}
            </h2>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-base leading-7 text-[color:var(--mist)]">
              {d[field.key]}
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}

function DocumentDetail({
  r,
  onToast,
}: {
  r: ArchiveRecord & { recordType: "document" };
  onToast: (message: string) => void;
}) {
  const d = r.recordData;
  const referenceById = new Map(d.sourceReferences.map((reference) => [reference.id, reference]));

  function citationLabel(id: string): string {
    const reference = referenceById.get(id);
    return reference ? `${reference.label}, ${reference.locator}` : "Unknown source";
  }

  async function openOriginal() {
    if (!d.storagePath) return;
    const { data, error } = await supabase.storage
      .from("document-files")
      .createSignedUrl(d.storagePath, 60);
    if (error || !data?.signedUrl) {
      onToast("The original file could not be opened.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  const insightSection = (
    heading: string,
    items: typeof d.highSignalFindings,
    defaultOpen = false,
  ) =>
    items.length === 0 ? null : (
      <details open={defaultOpen} className={PANEL}>
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm font-serif text-[1.5rem] text-foreground [&::-webkit-details-marker]:hidden",
            FOCUS_RING,
          )}
        >
          <span>{heading}</span>
          <span className="rounded-full border border-border px-2.5 py-0.5 font-sans text-sm text-muted-foreground">
            {items.length}
          </span>
        </summary>
        <ul className="mt-4 space-y-4">
          {items.map((item, index) => (
            <li key={`${heading}-${index}`} className="text-base leading-7 text-foreground">
              <p className="whitespace-pre-wrap">{item.text}</p>
              {item.sourceReferenceIds.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.sourceReferenceIds.map((id) => (
                    <span
                      key={id}
                      className="max-w-full break-words rounded-full border border-border px-2.5 py-1 text-sm text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      {citationLabel(id)}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    );
  return (
    <>
      <DlSection
        heading="Document details"
        entries={[
          ["Original file", d.originalFileName],
          ["MIME type", d.mimeType],
          ["Document date", d.documentDate],
          ["Page count", d.pageCount === null ? null : String(d.pageCount)],
          ["Project route", d.projectRoute],
        ]}
      />
      {d.storagePath ? (
        <section className={PANEL}>
          <button type="button" onClick={() => void openOriginal()} className={QUIET_BUTTON}>
            <CryptIcon glyph="scroll" size={20} className="text-[color:var(--parchment)]" />
            Open original file
          </button>
          <p className="mt-2 text-sm text-muted-foreground">
            Authenticated signed URL, valid for 60 seconds.
          </p>
        </section>
      ) : null}
      {insightSection("High-signal findings", d.highSignalFindings, true)}
      {insightSection("Key claims", d.keyClaims)}
      {insightSection("Contradictions", d.contradictions)}
      {insightSection("Uncertainties", d.uncertainties)}
      {d.sourceReferences.length ? (
        <details className={PANEL}>
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm font-serif text-[1.5rem] text-foreground [&::-webkit-details-marker]:hidden",
              FOCUS_RING,
            )}
          >
            <span>Source references</span>
            <span className="rounded-full border border-border px-2.5 py-0.5 font-sans text-sm text-muted-foreground">
              {d.sourceReferences.length}
            </span>
          </summary>
          <ul className="mt-4 space-y-4">
            {d.sourceReferences.map((ref) => (
              <li key={ref.id} className="text-base text-foreground">
                <div className="max-w-full break-words font-medium [overflow-wrap:anywhere]">
                  {ref.label}
                </div>
                <div className="max-w-full break-all font-mono text-sm text-muted-foreground">
                  {ref.locator}
                </div>
                {ref.note ? <div className="mt-1 whitespace-pre-wrap">{ref.note}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
