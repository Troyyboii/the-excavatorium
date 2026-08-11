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
import { useEffect, useState, type FormEvent } from "react";
import type {
  CaseMember,
  CaseStatus,
  Claim,
  CustodianAction,
  CustodianFinding,
  EvidenceItem,
  JsonValue,
} from "@/lib/custodian-types";
import type { ArchiveRecord } from "@/lib/types";
import { displayJson, parseWorkingSet, serializeWorkingSetEntry } from "@/lib/custodian-surfaces";
import { recordHref } from "@/components/record-list";
import { ArchiveErrorState, EmptyArchiveState, LoadingMark, Section } from "./custodian-ui";
import { formatRecordDate, valueOrNotRecorded } from "./custodian-format";

export type CustodianCaseView = {
  id: string;
  title: string;
  objective: string;
  currentQuestion: string;
  defaultWorkingSet: JsonValue[];
  status: CaseStatus;
  updatedAt: string;
};

export type CaseEditorValue = Pick<
  CustodianCaseView,
  "title" | "objective" | "currentQuestion" | "defaultWorkingSet" | "status"
>;

export function CaseListSurface({
  cases,
  loading = false,
  error,
  online = true,
  onCreate,
}: {
  cases?: readonly CustodianCaseView[];
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  onCreate: (value: CaseEditorValue) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!online}
          onClick={() => setCreating((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/55 bg-primary px-4 text-sm text-white-gold transition-colors hover:border-white-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <X size={17} /> : <Plus size={17} weight="bold" />}
          {creating ? "Close case form" : "Create case"}
        </button>
      </div>

      {creating ? (
        <CaseEditor
          submitLabel="Create case"
          onSubmit={async (value) => {
            await onCreate(value);
            setCreating(false);
          }}
        />
      ) : null}

      {error ? <ArchiveErrorState error={error} /> : null}
      {!error && (loading || cases === undefined) ? <LoadingMark /> : null}
      {!loading && cases?.length === 0 ? (
        <EmptyArchiveState
          title="No cases yet."
          hint="Create a case when material needs an objective, current question, and evidence-backed working set."
        />
      ) : null}
      {cases?.length ? (
        <Section
          title="Persisted cases"
          description="Objectives, current questions, and working sets stored in Supabase."
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
                <CaseValue label="Working set" value={item.defaultWorkingSet.length} />
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
  archiveRecords = [],
  loading = false,
  error,
  online = true,
  onUpdate,
}: {
  caseId: string;
  item?: CustodianCaseView;
  members?: readonly CaseMember[];
  claims?: readonly Claim[];
  evidence?: readonly EvidenceItem[];
  actions?: readonly CustodianAction[];
  findings?: readonly CustodianFinding[];
  archiveRecords?: readonly ArchiveRecord[];
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  onUpdate: (value: CaseEditorValue) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (error) return <ArchiveErrorState error={error} />;
  if (loading) return <LoadingMark label="Retrieving case and evidence…" />;
  if (!item)
    return (
      <EmptyArchiveState
        title="Case not found."
        hint={`No persisted case exists for ${caseId}. Nothing was inferred from the identifier.`}
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
          {editing ? "Cancel editing" : "Edit case"}
        </button>
      </div>

      {editing ? (
        <CaseEditor
          initial={item}
          submitLabel="Save case"
          onSubmit={async (value) => {
            await onUpdate(value);
            setEditing(false);
          }}
        />
      ) : null}

      <Section title={item.title} description={`Case ${item.id}`}>
        <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <CaseDetail label="Objective" value={item.objective} />
          <CaseDetail label="Current question" value={item.currentQuestion} />
          <CaseDetail label="Working set" value={item.defaultWorkingSet.length} />
          <CaseDetail label="Case status" value={item.status} />
        </dl>
        <p className="border-t border-luminous-gold/20 px-4 py-3 text-xs text-muted-foreground">
          Last updated {formatRecordDate(item.updatedAt)}
        </p>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <CaseCollection
          title="Claims"
          icon={MagnifyingGlass}
          empty="No claims are attached to this case."
          items={claims.map((claim) => ({
            id: claim.id,
            title: claim.statement,
            meta: `${claim.status} · ${claim.confidence}% confidence`,
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
          }))}
        />
        <CaseCollection
          title="Findings"
          icon={CheckCircle}
          empty="No findings are attached to this case."
          items={findings.map((finding) => ({
            id: finding.id,
            title: finding.title,
            meta: `${finding.analysisMode} · ${finding.status}`,
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
          title="Working set"
          description="Persisted archive references and other explicit case context."
        >
          {item.defaultWorkingSet.length ? (
            <ul className="divide-y divide-luminous-gold/15">
              {item.defaultWorkingSet.map((entry, index) => {
                const record = typeof entry === "string" ? recordsById.get(entry) : undefined;
                return (
                  <li key={`${index}-${displayJson(entry)}`} className="px-4 py-3 text-sm">
                    {record ? (
                      <Link to={recordHref(record)} className="text-white-gold hover:underline">
                        {record.title}
                      </Link>
                    ) : (
                      <span className="break-words text-foreground">{displayJson(entry)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">No working-set entries recorded.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function CaseEditor({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: CaseEditorValue;
  submitLabel: string;
  onSubmit: (value: CaseEditorValue) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [objective, setObjective] = useState(initial?.objective ?? "");
  const [currentQuestion, setCurrentQuestion] = useState(initial?.currentQuestion ?? "");
  const [workingSet, setWorkingSet] = useState(
    initial?.defaultWorkingSet.map(serializeWorkingSetEntry).join("\n") ?? "",
  );
  const [status, setStatus] = useState<CaseStatus>(initial?.status ?? "open");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initial?.title ?? "");
    setObjective(initial?.objective ?? "");
    setCurrentQuestion(initial?.currentQuestion ?? "");
    setWorkingSet(initial?.defaultWorkingSet.map(serializeWorkingSetEntry).join("\n") ?? "");
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
        defaultWorkingSet: parseWorkingSet(workingSet),
        status,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Case save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={initial ? "Edit case" : "New case"}>
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
        <CaseField label="Working set" hint="One archive record ID or context value per line.">
          <textarea
            value={workingSet}
            onChange={(event) => setWorkingSet(event.target.value)}
            rows={5}
          />
        </CaseField>
        <div className="flex flex-col items-start justify-end gap-3">
          {error ? <p className="text-sm text-risk">{error}</p> : null}
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/55 bg-primary px-4 text-sm text-white-gold disabled:cursor-not-allowed disabled:opacity-50"
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
  items: readonly { id: string; title: string; meta: string }[];
}) {
  return (
    <Section title={title}>
      {items.length ? (
        <ul className="divide-y divide-luminous-gold/15">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <Icon size={17} className="mt-0.5 shrink-0 text-luminous-gold" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm text-white-gold">{item.title}</span>
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                  {item.meta}
                </span>
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

function CaseValue({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <span className="hidden min-w-0 md:block">
      <span className="block text-[10px] uppercase tracking-wide text-brass-muted">{label}</span>
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
