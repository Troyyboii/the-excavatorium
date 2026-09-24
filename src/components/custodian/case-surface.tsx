import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckCircle,
  FileText,
  FloppyDisk,
  Gavel,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  CaseArchiveScope,
  CaseMember,
  CaseStatus,
  Claim,
  CustodianAction,
  CustodianFinding,
  CustodianFindingEvidence,
  EvidenceItem,
  JsonValue,
} from "@/lib/custodian-types";
import type { ArchiveRecord } from "@/lib/types";
import {
  CASE_ARCHIVE_CONTEXT_MAX_CHARS,
  CASE_READING_MAX_CHARS,
  CASE_ARCHIVE_SCOPE_MAX_RECORDS,
} from "@/lib/custodian-types";
import { displayJson } from "@/lib/custodian-surfaces";
import { recordHref } from "@/components/record-list";
import { ArchiveErrorState, EmptyArchiveState, LoadingMark, Section } from "./custodian-ui";
import { formatRecordDate, valueOrNotRecorded } from "./custodian-format";
import { CaseReadingSurface } from "./case-reading";
import { CaseScopePicker } from "./case-scope-picker";
import { InvestigationAnalysisPanel } from "./investigation-analysis";
import type { ReadonlyAnalysisPorts } from "@/lib/custodian-readonly-run";
import type { CustodianRun, CustodianRunRead } from "@/lib/custodian-runtime";
import type { ProviderKeyStatus } from "@/lib/provider-key";

export type CustodianCaseView = {
  id: string;
  title: string;
  objective: string;
  currentQuestion: string;
  defaultWorkingSet: JsonValue[];
  archiveScope: CaseArchiveScope;
  status: CaseStatus;
  updatedAt: string;
};

export type CaseEditorValue = {
  title: string;
  objective: string;
  currentQuestion: string;
  archiveScope: CaseArchiveScope;
  status: CaseStatus;
};

export function CaseListSurface({
  cases,
  loading = false,
  error,
  online = true,
  archiveRecords = [],
  archiveReady = false,
  archiveLoading = false,
  archiveError = null,
  archiveStale = false,
  initial,
  prefillError = null,
  onCreate,
}: {
  cases?: readonly CustodianCaseView[];
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  archiveRecords?: readonly ArchiveRecord[];
  archiveReady?: boolean;
  archiveLoading?: boolean;
  archiveError?: string | null;
  archiveStale?: boolean;
  initial?: CaseEditorValue;
  prefillError?: string | null;
  onCreate: (value: CaseEditorValue) => Promise<CustodianCaseView>;
}) {
  const [creating, setCreating] = useState(Boolean(initial));
  useEffect(() => {
    if (initial) setCreating(true);
  }, [initial]);
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!online}
          onClick={() => setCreating((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/55 bg-primary px-4 text-sm text-primary-foreground transition-colors hover:border-white-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <X size={17} /> : <Plus size={17} weight="bold" />}
          {creating ? "Close Investigation form" : "Start an Investigation"}
        </button>
      </div>

      {creating && archiveError ? (
        <p
          className="border border-[#b79b68]/45 bg-[#f5ead8] px-4 py-3 text-sm text-[#675c4f]"
          role="status"
        >
          {archiveStale
            ? "Archive refresh failed. The available cached records can still be selected."
            : "Archive selection is unavailable until the owner-scoped archive can be read."}{" "}
          {archiveError}
        </p>
      ) : null}

      {creating ? (
        <CaseEditor
          initial={initial}
          archiveRecords={archiveRecords}
          archiveReady={archiveReady}
          archiveLoading={archiveLoading}
          submitLabel="Create Investigation"
          onSubmit={async (value) => {
            await onCreate(value);
            setCreating(false);
          }}
        />
      ) : null}

      {prefillError ? (
        <p className="border border-risk/40 bg-risk/10 px-4 py-3 text-sm text-risk" role="alert">
          {prefillError}
        </p>
      ) : null}
      {error ? <ArchiveErrorState error={error} /> : null}
      {!error && (loading || cases === undefined) ? <LoadingMark /> : null}
      {!loading && cases?.length === 0 ? (
        <EmptyArchiveState
          title="No Investigations yet."
          hint="Start an Investigation when material needs a question and a bounded archive scope."
        />
      ) : null}
      {cases?.length ? (
        <Section
          title="Investigations"
          description="Objectives, current questions, lifecycle, and bounded archive scope stored in Supabase."
        >
          <div className="divide-y divide-luminous-gold/15">
            {cases.map((item) => (
              <Link
                key={item.id}
                to="/cases/$caseId"
                params={{ caseId: item.id }}
                className="grid min-h-20 gap-3 px-4 py-3 transition-colors hover:bg-burgundy-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold md:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.9fr)_110px_90px_auto] md:items-center"
              >
                <span className="min-w-0">
                  <span className="block truncate font-serif text-base text-white-gold">
                    {item.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {item.currentQuestion || "No current question recorded."}
                  </span>
                </span>
                <CaseValue label="Objective" value={item.objective} />
                <CaseValue label="Status" value={item.status} />
                <CaseValue label="Archive scope" value={item.archiveScope.recordIds.length} />
                <ArrowUpRight size={16} className="text-luminous-gold" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

export function CaseDetailSurface({
  caseId,
  item,
  members = [],
  claims = [],
  evidence = [],
  actions = [],
  findings = [],
  findingEvidence = [],
  archiveRecords = [],
  archiveReady = false,
  archiveLoading = false,
  archiveError = null,
  archiveStale = false,
  loading = false,
  error,
  online = true,
  onUpdate,
  analysisPorts = null,
  analysisRuns = [],
  providerHoldProjection = "available",
  providerKeyStatus = null,
  modelPreference = null,
  settingsLoading = false,
}: {
  caseId: string;
  item?: CustodianCaseView;
  members?: readonly CaseMember[];
  claims?: readonly Claim[];
  evidence?: readonly EvidenceItem[];
  actions?: readonly CustodianAction[];
  findings?: readonly CustodianFinding[];
  findingEvidence?: readonly CustodianFindingEvidence[];
  archiveRecords?: readonly ArchiveRecord[];
  archiveReady?: boolean;
  archiveLoading?: boolean;
  archiveError?: string | null;
  archiveStale?: boolean;
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  onUpdate: (value: CaseEditorValue) => Promise<void>;
  analysisPorts?: ReadonlyAnalysisPorts | null;
  analysisRuns?: readonly CustodianRun[];
  providerHoldProjection?: CustodianRunRead["providerHoldProjection"];
  providerKeyStatus?: ProviderKeyStatus | null;
  modelPreference?: string | null;
  settingsLoading?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (error) return <ArchiveErrorState error={error} />;
  if (loading) return <LoadingMark label="Retrieving case and evidence…" />;
  if (!item)
    return (
      <EmptyArchiveState
        title="Investigation not found."
        hint={`No persisted Investigation exists for ${caseId}. Nothing was inferred from the identifier.`}
      />
    );

  const recordsById = new Map(archiveRecords.map((record) => [record.id, record]));
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!online}
          onClick={() => setEditing((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/40 px-4 text-sm text-white-gold transition-colors hover:bg-burgundy-muted/45 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editing ? <X size={17} /> : <PencilSimple size={17} />}
          {editing ? "Cancel editing" : "Edit Investigation"}
        </button>
      </div>

      {editing ? (
        <CaseEditor
          initial={item}
          archiveRecords={archiveRecords}
          archiveReady={archiveReady}
          archiveLoading={archiveLoading}
          submitLabel="Save Investigation"
          onSubmit={async (value) => {
            await onUpdate(value);
            setEditing(false);
          }}
        />
      ) : null}

      <Section title={item.title} description="Investigation">
        <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <CaseDetail label="Objective" value={item.objective} />
          <CaseDetail label="Current question" value={item.currentQuestion} />
          <CaseDetail label="Archive scope" value={item.archiveScope.recordIds.length} />
          <CaseDetail
            label="Owner context"
            value={item.archiveScope.freeTextContext.trim() ? "Recorded" : "Not recorded"}
          />
          <CaseDetail label="Status" value={item.status} />
        </dl>
        <p className="border-t border-luminous-gold/20 px-4 py-3 text-xs text-muted-foreground">
          Last updated {formatRecordDate(item.updatedAt)}
        </p>
      </Section>

      <CaseReadingSurface
        scope={item.archiveScope}
        archiveRecords={archiveRecords}
        archiveReady={archiveReady}
        archiveLoading={archiveLoading}
        archiveError={archiveError}
        archiveStale={archiveStale}
      />

      <InvestigationAnalysisPanel
        caseId={caseId}
        objective={item.objective}
        currentQuestion={item.currentQuestion}
        online={online}
        ports={analysisPorts}
        runs={analysisRuns}
        providerHoldProjection={providerHoldProjection}
        providerKeyStatus={providerKeyStatus}
        modelPreference={modelPreference}
        settingsLoading={settingsLoading}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <CaseCollection
          title="Claims"
          icon={MagnifyingGlass}
          empty="No claims are attached to this case."
          items={claims.map((claim) => ({
            id: claim.id,
            title: claim.statement,
            meta: `${claim.status} · ${claim.confidence}% confidence`,
            sourceRecord: claim.sourceRecordId ? recordsById.get(claim.sourceRecordId) : undefined,
          }))}
        />
        <CaseCollection
          title="Evidence"
          icon={FileText}
          empty="No evidence items are attached to this case."
          items={evidence.map((entry) => ({
            id: entry.id,
            title: entry.title || "Untitled evidence",
            meta: `${entry.sourceClassification} · captured ${formatRecordDate(entry.capturedAt)}`,
            sourceRecord: entry.sourceRecordId ? recordsById.get(entry.sourceRecordId) : undefined,
          }))}
        />
        <CaseCollection
          title="Findings"
          icon={CheckCircle}
          empty="No Custodian Findings yet. Findings are interpretations from analysis — not Owner Judgment."
          items={findings.map((finding) => ({
            id: finding.id,
            title: finding.title,
            meta: `${finding.analysisMode} · ${finding.status} · ${finding.originKind}${
              findingEvidence.some(
                (link) => link.findingId === finding.id && link.relationshipKind === "contrary",
              )
                ? " · contrary material"
                : ""
            }`,
            sourceRecord: finding.sourceRecordId
              ? recordsById.get(finding.sourceRecordId)
              : undefined,
            details: (
              <FindingDetails
                finding={finding}
                evidence={evidence}
                evidenceLinks={findingEvidence.filter((link) => link.findingId === finding.id)}
              />
            ),
          }))}
        />
        <CaseCollection
          title="Actions"
          icon={Gavel}
          empty="No actions are attached to this case."
          items={actions.map((action) => ({
            id: action.id,
            title: action.title,
            meta: `${action.status} · priority ${action.priority}`,
          }))}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CaseCollection
          title="Actors and members"
          icon={UsersThree}
          empty="No actors or members are attached to this case."
          items={members.map((member) => ({
            id: member.id,
            title: member.displayName,
            meta: `${member.roleLabel || "Role not recorded"} · ${member.lifecycleStatus}`,
          }))}
        />
        <Section
          title="Archive scope"
          description={`Selected canonical records only · maximum ${CASE_ARCHIVE_SCOPE_MAX_RECORDS}`}
        >
          {item.archiveScope.recordIds.length ? (
            <ul className="divide-y divide-luminous-gold/15">
              {item.archiveScope.recordIds.map((recordId) => {
                const record = recordsById.get(recordId);
                return (
                  <li key={recordId} className="px-4 py-3 text-sm">
                    {record ? (
                      <Link to={recordHref(record)} className="text-white-gold hover:underline">
                        {record.title}
                      </Link>
                    ) : (
                      <span className="break-words text-risk">
                        Unavailable in the current archive snapshot · {recordId}
                      </span>
                    )}
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                      {record?.recordType ?? "record"} · {recordId}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">No archive records selected.</p>
          )}
        </Section>
        <Section
          title="Owner context"
          description="Free-text context supplied by the owner. It is not archive evidence and is not included as a record."
        >
          {item.archiveScope.freeTextContext.trim() ? (
            <p className="whitespace-pre-wrap break-words p-4 text-sm text-foreground">
              {item.archiveScope.freeTextContext}
            </p>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">No owner context recorded.</p>
          )}
        </Section>
        {item.defaultWorkingSet.length ? (
          <Section
            title="Legacy working set"
            description="Preserved for compatibility; not used as archive evidence or Case Reading."
          >
            <ul className="divide-y divide-luminous-gold/15">
              {item.defaultWorkingSet.map((entry, index) => (
                <li
                  key={`${index}-${displayJson(entry)}`}
                  className="break-words px-4 py-3 text-sm text-muted-foreground"
                >
                  {displayJson(entry)}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function CaseEditor({
  initial,
  archiveRecords,
  archiveReady,
  archiveLoading,
  submitLabel,
  onSubmit,
}: {
  initial?: CaseEditorValue;
  archiveRecords: readonly ArchiveRecord[];
  archiveReady: boolean;
  archiveLoading: boolean;
  submitLabel: string;
  onSubmit: (value: CaseEditorValue) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [objective, setObjective] = useState(initial?.objective ?? "");
  const [currentQuestion, setCurrentQuestion] = useState(initial?.currentQuestion ?? "");
  const [archiveScope, setArchiveScope] = useState<CaseArchiveScope>(
    initial?.archiveScope ?? { recordIds: [], freeTextContext: "" },
  );
  const [status, setStatus] = useState<CaseStatus>(initial?.status ?? "open");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initial?.title ?? "");
    setObjective(initial?.objective ?? "");
    setCurrentQuestion(initial?.currentQuestion ?? "");
    setArchiveScope(initial?.archiveScope ?? { recordIds: [], freeTextContext: "" });
    setStatus(initial?.status ?? "open");
  }, [initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        objective: objective.trim(),
        currentQuestion: currentQuestion.trim(),
        archiveScope,
        status,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Case save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={initial ? "Edit Investigation" : "New Investigation"}>
      <form onSubmit={submit} className="grid gap-4 p-4 lg:grid-cols-2">
        <CaseField label="Title" required>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} />
        </CaseField>
        <CaseField label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value as CaseStatus)}>
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
        </CaseField>
        <CaseField label="Objective">
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            rows={4}
          />
        </CaseField>
        <CaseField label="Current question">
          <textarea
            value={currentQuestion}
            onChange={(event) => setCurrentQuestion(event.target.value)}
            rows={4}
          />
        </CaseField>
        <div className="grid gap-2 text-sm text-foreground lg:col-span-2">
          <span>Archive evidence</span>
          <CaseScopePicker
            all={archiveRecords}
            value={archiveScope.recordIds}
            onChange={(recordIds) => setArchiveScope((scope) => ({ ...scope, recordIds }))}
            disabled={archiveLoading || !archiveReady}
          />
          <span className="text-xs text-muted-foreground">
            Select owner-visible canonical archive records in reading order. Maximum{" "}
            {CASE_ARCHIVE_SCOPE_MAX_RECORDS}; Case Reading is bounded at{" "}
            {CASE_READING_MAX_CHARS.toLocaleString()} serialized characters.
          </span>
          {archiveScope.recordIds.length && !archiveReady ? (
            <span className="text-xs text-risk" role="alert">
              Load the archive before saving selected evidence.
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 text-sm text-foreground lg:col-span-2">
          <span>Owner context (not archive evidence)</span>
          <textarea
            value={archiveScope.freeTextContext}
            onChange={(event) =>
              setArchiveScope((scope) => ({ ...scope, freeTextContext: event.target.value }))
            }
            maxLength={CASE_ARCHIVE_CONTEXT_MAX_CHARS}
            rows={5}
            className="border border-luminous-gold/30 bg-background px-3 py-2"
            aria-label="Owner context (not archive evidence)"
          />
          <span className="text-xs text-muted-foreground">
            Explicit context stays attached to the Case and is never represented as an archive
            record. {archiveScope.freeTextContext.length.toLocaleString()}/
            {CASE_ARCHIVE_CONTEXT_MAX_CHARS.toLocaleString()} characters.
          </span>
        </div>
        <div className="flex flex-col items-start justify-end gap-3">
          {error ? <p className="text-sm text-risk">{error}</p> : null}
          <button
            type="submit"
            disabled={
              saving || !title.trim() || (archiveScope.recordIds.length > 0 && !archiveReady)
            }
            className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/55 bg-primary px-4 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FloppyDisk size={17} />
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </Section>
  );
}

function CaseField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm text-foreground [&_input]:min-h-11 [&_input]:border [&_input]:border-luminous-gold/30 [&_input]:bg-background [&_input]:px-3 [&_select]:min-h-11 [&_select]:border [&_select]:border-luminous-gold/30 [&_select]:bg-background [&_select]:px-3 [&_textarea]:border [&_textarea]:border-luminous-gold/30 [&_textarea]:bg-background [&_textarea]:px-3 [&_textarea]:py-2">
      <span>
        {label}
        {required ? <span className="text-luminous-gold"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function CaseCollection({
  title,
  icon: Icon,
  empty,
  items,
}: {
  title: string;
  icon: typeof MagnifyingGlass;
  empty: string;
  items: readonly {
    id: string;
    title: string;
    meta: string;
    sourceRecord?: ArchiveRecord;
    details?: ReactNode;
  }[];
}) {
  return (
    <Section title={title}>
      {items.length ? (
        <ul className="divide-y divide-luminous-gold/15">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <Icon size={17} className="mt-0.5 shrink-0 text-luminous-gold" aria-hidden="true" />
              <span className="min-w-0">
                {item.sourceRecord ? (
                  <Link
                    to={recordHref(item.sourceRecord)}
                    className="flex min-h-11 items-center text-sm text-white-gold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="block text-sm text-white-gold">{item.title}</span>
                )}
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                  {item.meta}
                </span>
                {item.sourceRecord ? (
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Source record: {item.sourceRecord.title}
                  </span>
                ) : null}
                {item.details ? <div className="mt-3">{item.details}</div> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">{empty}</p>
      )}
    </Section>
  );
}

export function FindingDetails({
  finding,
  evidence,
  evidenceLinks,
}: {
  finding: CustodianFinding;
  evidence: readonly EvidenceItem[];
  evidenceLinks: readonly CustodianFindingEvidence[];
}) {
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const supporting = evidenceLinks.filter((link) => link.relationshipKind === "supporting");
  const contrary = evidenceLinks.filter((link) => link.relationshipKind === "contrary");
  const caveats = [
    ["Uncertainty", finding.uncertainties],
    ["Assumptions", finding.assumptions],
    ["Scope limits", finding.scopeLimits],
    ["Missing evidence", finding.evidenceGaps],
  ] as const;
  const evidenceTitles = (links: readonly CustodianFindingEvidence[]) =>
    links
      .map((link) => evidenceById.get(link.evidenceId)?.title ?? `Unavailable · ${link.evidenceId}`)
      .join(", ");

  return (
    <div className="space-y-3 border-l border-luminous-gold/30 pl-3 text-sm leading-6 text-muted-foreground">
      <p className="text-xs text-muted-foreground">
        Custodian Finding — an attributable interpretation. This is not Owner Judgment (Review).
      </p>
      <p className="break-words whitespace-pre-wrap">
        <span className="font-medium text-foreground">Conclusion:</span> {finding.finding}
      </p>
      {supporting.length ? (
        <p className="break-words">
          <span className="font-medium text-foreground">Supporting evidence:</span>{" "}
          {evidenceTitles(supporting)}
        </p>
      ) : null}
      {contrary.length ? (
        <p className="break-words">
          <span className="font-medium text-foreground">Tensions and alternatives:</span>{" "}
          {evidenceTitles(contrary)}
        </p>
      ) : null}
      {caveats.map(([label, values]) =>
        values.length ? (
          <p key={label} className="break-words">
            <span className="font-medium text-foreground">{label}:</span> {values.join("; ")}
          </p>
        ) : null,
      )}
      {finding.whatWouldChangeMind ? (
        <p className="break-words whitespace-pre-wrap">
          <span className="font-medium text-foreground">What would change this conclusion:</span>{" "}
          {finding.whatWouldChangeMind}
        </p>
      ) : null}
      {finding.revisitCondition ? (
        <p className="break-words whitespace-pre-wrap">
          <span className="font-medium text-foreground">Revisit condition:</span>{" "}
          {finding.revisitCondition}
        </p>
      ) : null}
      <details className="border-t border-border/70 pt-2">
        <summary className="min-h-11 cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Analysis details
        </summary>
        <div className="space-y-2 break-words pb-2 pt-1 text-xs">
          <p>
            <span className="font-medium text-foreground">Numeric confidence:</span>{" "}
            {finding.confidence}% (not a calibrated probability)
          </p>
          <p>
            <span className="font-medium text-foreground">Origin:</span> {finding.originKind}
            {finding.analysisOutcome ? ` · ${finding.analysisOutcome}` : ""}
          </p>
          {finding.originKind === "analysis" ? (
            <p className="font-mono text-[10px]">
              Run {finding.originRunId ?? "unavailable"} · synthesis step{" "}
              {finding.originStepId ?? "unavailable"} · candidate{" "}
              {finding.candidateIndex ?? "unavailable"}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function CaseValue({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <span className="hidden min-w-0 md:block">
      <span className="block text-[10px] uppercase tracking-wide text-luminous-gold">{label}</span>
      <span className="mt-1 block truncate text-xs text-foreground">
        {valueOrNotRecorded(value)}
      </span>
    </span>
  );
}

function CaseDetail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-white-gold">{valueOrNotRecorded(value)}</dd>
    </div>
  );
}
