import { Link } from "@tanstack/react-router";
import { ArrowUpRight, FileText } from "@phosphor-icons/react";
import type { ArchiveRecord } from "@/lib/types";
import type { CustodianRecordContext } from "@/lib/custodian-types";
import { EVIDENCE_DISPLAY_MAX_CHARACTERS, formatEvidenceContent } from "@/lib/evidence-display";
import { formatRecordDate } from "./custodian-format";
import { FoundationState, LoadingMark } from "./custodian-ui";

function lifecycleRank(value: string): number {
  return value === "active" ? 0 : value === "superseded" ? 1 : value === "rejected" ? 2 : 3;
}

function sortByLifecycle<T extends { lifecycleStatus: string; updatedAt: string }>(items: T[]) {
  return [...items].sort(
    (a, b) =>
      lifecycleRank(a.lifecycleStatus) - lifecycleRank(b.lifecycleStatus) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function RecordEvidenceReader({
  record,
  context,
  linkedRecordCount,
  backlinkCount,
  loading = false,
  online = true,
  foundationPending = false,
  error = null,
}: {
  record: ArchiveRecord;
  context?: CustodianRecordContext;
  linkedRecordCount: number;
  backlinkCount: number;
  loading?: boolean;
  online?: boolean;
  foundationPending?: boolean;
  error?: string | null;
}) {
  const cases = context?.cases ?? [];
  const evidence = context ? sortByLifecycle(context.evidence) : [];
  const claims = context ? sortByLifecycle(context.claims) : [];
  const findings = context ? sortByLifecycle(context.findings) : [];

  return (
    <aside className="space-y-6" aria-label="Record evidence reader">
      <section className="border border-border bg-card p-4 md:p-5">
        <div className="flex items-center gap-2">
          <FileText size={17} className="text-[color:var(--luminous-gold)]" aria-hidden="true" />
          <h2 className="font-serif text-lg text-foreground">Source provenance</h2>
        </div>
        <dl className="mt-4 space-y-3 text-xs">
          <MetaRow label="Record ID" value={record.id} mono />
          <MetaRow label="Record class" value={record.recordType} />
          <MetaRow label="Created" value={formatRecordDate(record.createdAt)} />
          <MetaRow label="Updated" value={formatRecordDate(record.updatedAt)} />
          <MetaRow label="Linked records" value={linkedRecordCount} />
          <MetaRow label="Backlinks" value={backlinkCount} />
        </dl>
      </section>

      <section className="border border-border bg-card" aria-labelledby="case-context-heading">
        <header className="border-b border-border px-4 py-3">
          <h2 id="case-context-heading" className="font-serif text-lg text-foreground">
            Case context
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Persisted Custodian cases connected to this record.
          </p>
        </header>
        {cases.length ? (
          <div className="divide-y divide-border">
            {cases.map((item) => (
              <div key={item.id} className="space-y-2 px-4 py-3 text-sm">
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: item.id }}
                  className="inline-flex min-h-11 items-center gap-2 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--luminous-gold)]"
                >
                  {item.title}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
                <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <span>{item.status}</span>
                  {item.currentQuestion ? <span>· {item.currentQuestion}</span> : null}
                </div>
                {item.objective ? (
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {item.objective}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">No linked case recorded.</p>
        )}
      </section>

      <section
        className="border border-border bg-card"
        aria-labelledby="persisted-evidence-heading"
      >
        <header className="border-b border-border px-4 py-3">
          <h2 id="persisted-evidence-heading" className="font-serif text-lg text-foreground">
            Persisted evidence
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Source material stored by the authenticated Custodian foundation.
          </p>
        </header>
        {!context && loading ? <LoadingMark label="Retrieving linked evidence…" /> : null}
        {!context && !loading && !online ? (
          <FoundationState title="Evidence context blocked">
            Network unavailable. The canonical record remains readable, but linked Custodian
            material could not be retrieved.
          </FoundationState>
        ) : null}
        {!context && !loading && online && foundationPending ? (
          <FoundationState title="Custodian foundation pending">
            The canonical record is available. Linked evidence will appear when the persisted
            Custodian foundation is available.
          </FoundationState>
        ) : null}
        {!context && !loading && online && !foundationPending && error ? (
          <FoundationState title="Evidence context unavailable">{error}</FoundationState>
        ) : null}
        {context && error ? (
          <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
            Showing the last persisted context. The latest refresh failed: {error}
          </p>
        ) : null}
        {context && evidence.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No persisted evidence is linked to this record.
          </p>
        ) : null}
        {context && evidence.length ? (
          <div className="divide-y divide-border">
            {evidence.map((entry) => (
              <EvidenceEntry key={entry.id} entry={entry} context={context} />
            ))}
          </div>
        ) : null}
      </section>

      <section
        className="border border-sidebar-border bg-sidebar text-sidebar-foreground"
        aria-labelledby="custodian-reading-heading"
      >
        <header className="border-b border-sidebar-border px-4 py-3">
          <h2 id="custodian-reading-heading" className="font-serif text-lg">
            Interpretation — not source truth
          </h2>
          <p className="mt-1 text-xs text-sidebar-foreground/70">
            Persisted claims and findings only. No model run was requested or simulated.
          </p>
        </header>
        {!context && loading ? <LoadingMark label="Retrieving persisted interpretation…" /> : null}
        {context && claims.length === 0 && findings.length === 0 ? (
          <p className="px-4 py-4 text-sm text-sidebar-foreground/70">
            No persisted claims or findings are linked to this record.
          </p>
        ) : null}
        {context && claims.length ? (
          <div className="border-b border-sidebar-border px-4 py-4">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-ring">
              Claims
            </h3>
            <div className="mt-3 space-y-4">
              {claims.map((claim) => (
                <ClaimEntry key={claim.id} claim={claim} context={context} />
              ))}
            </div>
          </div>
        ) : null}
        {context && findings.length ? (
          <div className="px-4 py-4">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-ring">
              Findings
            </h3>
            <div className="mt-3 space-y-4">
              {findings.map((finding) => (
                <FindingEntry key={finding.id} finding={finding} />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}

function EvidenceEntry({
  entry,
  context,
}: {
  entry: CustodianRecordContext["evidence"][number];
  context: CustodianRecordContext;
}) {
  const rendered = formatEvidenceContent(entry.content);
  const sourceUrl = safeHttpUrl(entry.sourceUri);
  const superseded = entry.supersedesId
    ? context.evidence.find((candidate) => candidate.id === entry.supersedesId)
    : undefined;
  return (
    <article className="space-y-3 px-4 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium text-foreground">
          {entry.title || "Untitled evidence"}
        </h3>
        <StatusPill value={entry.lifecycleStatus} />
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span>{entry.sourceClassification}</span>
        <span>· captured {formatRecordDate(entry.capturedAt)}</span>
        <span>· {entry.immutable ? "immutable" : "mutable"}</span>
      </div>
      <div>
        <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
          {rendered.text}
        </pre>
        {rendered.truncated ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Display truncated at {EVIDENCE_DISPLAY_MAX_CHARACTERS.toLocaleString()} characters.
          </p>
        ) : null}
      </div>
      <dl className="space-y-2 border-t border-border pt-3 text-xs">
        <MetaRow label="Content hash" value={entry.contentHash} mono />
        {entry.sourceUri ? (
          <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">Source URI</dt>
            <dd className="break-all font-mono text-foreground">
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center rounded-md px-1 underline underline-offset-4 hover:text-sidebar-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  {entry.sourceUri}
                </a>
              ) : (
                entry.sourceUri
              )}
            </dd>
          </div>
        ) : null}
        {entry.supersedesId ? (
          <MetaRow
            label="Supersedes"
            value={superseded ? superseded.title : entry.supersedesId}
            mono={!superseded}
          />
        ) : null}
        {Object.keys(entry.provenance).length ? (
          <div>
            <dt className="text-muted-foreground">Provenance</dt>
            <dd className="mt-1">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[10px] text-foreground">
                {formatEvidenceContent(entry.provenance).text}
              </pre>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function ClaimEntry({
  claim,
  context,
}: {
  claim: CustodianRecordContext["claims"][number];
  context: CustodianRecordContext;
}) {
  const relatedEvidence = context.claimEvidence
    .filter((link) => link.claimId === claim.id)
    .map((link) => ({
      link,
      evidence: context.evidence.find((entry) => entry.id === link.evidenceId),
    }));
  return (
    <article className="space-y-2 border-t border-sidebar-border pt-3 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <p className="break-words whitespace-pre-wrap text-sm">{claim.statement}</p>
        <StatusPill value={claim.lifecycleStatus} inverse />
      </div>
      <p className="font-mono text-[10px] text-sidebar-foreground/70">
        {claim.status} · {claim.confidence}% confidence
      </p>
      {claim.whatWouldChangeMind ? (
        <p className="break-words whitespace-pre-wrap text-xs text-sidebar-foreground/80">
          <span className="font-medium">Change condition:</span> {claim.whatWouldChangeMind}
        </p>
      ) : null}
      {claim.revisitCondition ? (
        <p className="break-words whitespace-pre-wrap text-xs text-sidebar-foreground/80">
          <span className="font-medium">Revisit:</span> {claim.revisitCondition}
        </p>
      ) : null}
      {relatedEvidence.length ? (
        <ul className="space-y-1 text-xs text-sidebar-foreground/70">
          {relatedEvidence.map(({ link, evidence }) => (
            <li key={link.id}>
              Evidence: {evidence?.title ?? `Unavailable · ${link.evidenceId}`}
              {link.relationshipNote ? ` · ${link.relationshipNote}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function FindingEntry({ finding }: { finding: CustodianRecordContext["findings"][number] }) {
  return (
    <article className="space-y-2 border-t border-sidebar-border pt-3 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">{finding.title}</h4>
          <p className="mt-1 font-mono text-[10px] text-sidebar-foreground/70">
            {finding.analysisMode} · {finding.status} · {finding.confidence}% confidence
          </p>
        </div>
        <StatusPill value={finding.lifecycleStatus} inverse />
      </div>
      <p className="break-words whitespace-pre-wrap text-sm">{finding.finding}</p>
      {finding.whatWouldChangeMind ? (
        <p className="break-words whitespace-pre-wrap text-xs text-sidebar-foreground/80">
          <span className="font-medium">Change condition:</span> {finding.whatWouldChangeMind}
        </p>
      ) : null}
      {finding.revisitCondition ? (
        <p className="break-words whitespace-pre-wrap text-xs text-sidebar-foreground/80">
          <span className="font-medium">Revisit:</span> {finding.revisitCondition}
        </p>
      ) : null}
    </article>
  );
}

function StatusPill({ value, inverse = false }: { value: string; inverse?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[10px] ${
        inverse
          ? "border-sidebar-border text-sidebar-foreground/80"
          : "border-border text-muted-foreground"
      }`}
    >
      {value}
    </span>
  );
}
