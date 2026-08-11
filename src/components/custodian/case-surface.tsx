import { ArrowUpRight, CheckCircle, FileText, Gavel, MagnifyingGlass } from "@phosphor-icons/react";
import {
  ArchiveErrorState,
  EmptyArchiveState,
  FoundationState,
  LoadingMark,
  Section,
} from "./custodian-ui";
import { formatRecordDate, valueOrNotRecorded } from "./custodian-format";

export type CustodianCase = {
  id: string;
  title: string;
  objective?: string | null;
  currentQuestion?: string | null;
  workingSetCount?: number | null;
  evidenceCount?: number | null;
  status?: string | null;
  updatedAt?: string | null;
  findings?: readonly string[];
  actions?: readonly string[];
};

export function CaseListSurface({
  cases,
  foundationPending = false,
  loading = false,
  error,
}: {
  cases?: readonly CustodianCase[];
  foundationPending?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  if (foundationPending) {
    return (
      <FoundationState title="Case foundation pending">
        The owner-scoped case reader is connected. Apply the reviewed Custodian migration before
        persisted cases become available.
      </FoundationState>
    );
  }
  if (error) return <ArchiveErrorState error={error} />;
  if (loading || cases === undefined) return <LoadingMark />;
  if (cases.length === 0)
    return (
      <EmptyArchiveState
        title="No persisted cases."
        hint="The case reader returned an empty result."
      />
    );
  return (
    <Section
      title="Persisted cases"
      description="Objectives, current state, and working sets shown only when persisted."
    >
      <div className="divide-y divide-luminous-gold/15">
        {cases.map((item) => (
          <a
            key={item.id}
            href={`/cases/${item.id}`}
            className="grid min-h-20 gap-3 px-4 py-3 transition-colors hover:bg-burgundy-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_120px_100px_auto] md:items-center"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-white-gold">{item.title}</span>
              <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                {item.id}
              </span>
            </span>
            <CaseValue label="Objective" value={item.objective} />
            <CaseValue label="Status" value={item.status} />
            <CaseValue label="Working set" value={item.workingSetCount} />
            <ArrowUpRight size={16} className="text-luminous-gold" aria-hidden="true" />
          </a>
        ))}
      </div>
    </Section>
  );
}

export function CaseDetailSurface({
  caseId,
  item,
  foundationPending = false,
  loading = false,
  error,
}: {
  caseId: string;
  item?: CustodianCase;
  foundationPending?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  if (foundationPending) {
    return (
      <FoundationState title="Case detail foundation pending">
        The owner-scoped case reader is connected. Apply the reviewed Custodian migration before
        persisted case detail becomes available.
      </FoundationState>
    );
  }
  if (error) return <ArchiveErrorState error={error} />;
  if (loading || item === undefined) {
    return item === undefined && !loading ? (
      <EmptyArchiveState
        title="Case not found."
        hint={`The persisted case reader returned no case for ${caseId}. Nothing was inferred from the identifier.`}
      />
    ) : (
      <LoadingMark />
    );
  }
  return (
    <div className="space-y-6">
      <Section title={item.title} description={`Case ${item.id}`}>
        <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <CaseDetail label="Objective" value={item.objective} />
          <CaseDetail label="Current question" value={item.currentQuestion} />
          <CaseDetail label="Working set" value={item.workingSetCount} />
          <CaseDetail label="Case status" value={item.status} />
        </dl>
        {item.updatedAt ? (
          <p className="border-t border-luminous-gold/20 px-4 py-3 text-xs text-muted-foreground">
            Last updated {formatRecordDate(item.updatedAt)}
          </p>
        ) : null}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <CaseList title="Findings" icon={MagnifyingGlass} items={item.findings} />
        <CaseList title="Actions" icon={Gavel} items={item.actions} />
      </div>

      <Section
        title="Evidence register"
        description="Only evidence attached to this persisted case is shown."
      >
        {item.evidenceCount ? (
          <div className="flex items-center gap-3 p-5 text-sm text-foreground">
            <FileText size={18} className="text-luminous-gold" aria-hidden="true" />
            {item.evidenceCount} evidence item{item.evidenceCount === 1 ? "" : "s"} recorded.
            Evidence detail will appear when the evidence relation is connected.
          </div>
        ) : (
          <div className="p-5 text-sm text-muted-foreground">
            No evidence count is recorded for this case.
          </div>
        )}
      </Section>
    </div>
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

function CaseList({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof MagnifyingGlass;
  items?: readonly string[];
}) {
  return (
    <Section title={title}>
      {items?.length ? (
        <ul className="divide-y divide-luminous-gold/15">
          {items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex items-start gap-3 px-4 py-3 text-sm text-foreground"
            >
              <CheckCircle
                size={17}
                className="mt-0.5 shrink-0 text-luminous-gold"
                aria-hidden="true"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <Icon size={17} className="text-brass-muted" aria-hidden="true" />
          No {title.toLowerCase()} recorded.
        </div>
      )}
    </Section>
  );
}
