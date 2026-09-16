import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  LinkSimple,
  Warning,
} from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import { buildDashboardViewModel } from "@/lib/dashboard";
import type { ArchiveLink, ArchiveRecord } from "@/lib/types";
import { RECORD_TYPE_LABEL } from "@/lib/types";
import { recordHref, TypeIcon } from "@/components/record-list";
import { useOnlineStatus } from "@/hooks/use-online";
import { formatArchiveDate, formatArchiveDateTime } from "@/lib/date-format";

export const Route = createFileRoute("/")({ component: CustodianDesk, ssr: false });

function CustodianDesk() {
  const archive = useArchive(true);
  const online = useOnlineStatus();
  const model = useMemo(
    () => (archive.data ? buildDashboardViewModel(archive.data.records, archive.data.links) : null),
    [archive.data],
  );

  if (archive.state.isColdOffline) {
    return (
      <section className="custodian-rule-section">
        <DeskHeading
          eyebrow="System state"
          title="Custodian Desk"
          description="The archive is unavailable on this device while offline."
        />
        <OperationalNotice tone="risk" title="No cached archive">
          Reconnect to retrieve persisted records. Cached archive material will remain visible when
          available.
        </OperationalNotice>
      </section>
    );
  }

  if (!archive.data && archive.isPending) {
    return <DeskLoading />;
  }

  if (!archive.data || !model) {
    return (
      <section className="custodian-rule-section">
        <DeskHeading
          eyebrow="System state"
          title="Custodian Desk"
          description="The archive could not be assembled."
        />
        <OperationalNotice tone="risk" title="Archive unavailable">
          <span>{archive.recordsError?.message ?? "The records request failed."}</span>
          <button
            type="button"
            className="text-white-gold underline"
            onClick={() => void archive.refetch()}
          >
            Retry
          </button>
        </OperationalNotice>
      </section>
    );
  }

  return (
    <CustodianDeskSurface
      records={archive.data.records}
      links={archive.data.links}
      model={model}
      online={online}
      linksPending={archive.state.linksPending}
      linksError={Boolean(archive.linksError)}
      isFetching={archive.isFetching}
      lastSuccessfulSync={archive.state.lastSuccessfulSync}
      onRetry={() => void archive.refetch()}
    />
  );
}

export function CustodianDeskSurface({
  records,
  links,
  model,
  online,
  linksPending,
  linksError,
  isFetching,
  lastSuccessfulSync,
  onRetry,
}: {
  records: ArchiveRecord[];
  links: ArchiveLink[];
  model: ReturnType<typeof buildDashboardViewModel>;
  online: boolean;
  linksPending: boolean;
  linksError: boolean;
  isFetching: boolean;
  lastSuccessfulSync: number | null;
  onRetry: () => void;
}) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const workingSets = buildWorkingSets(records);
  const evidenceTrace = links
    .map((link) => ({ link, source: byId.get(link.sourceId), target: byId.get(link.targetId) }))
    .filter((item) => item.source && item.target)
    .slice(0, 5);

  return (
    <div className="space-y-7">
      <DeskHeading
        eyebrow="Operational brief"
        title="Custodian Desk"
        description="Evidence, unfinished judgments, and the archive state that can be verified now."
      />

      <section
        className="grid overflow-hidden border border-strong-border bg-card lg:grid-cols-[minmax(0,1fr)_260px]"
        aria-labelledby="archive-boundary-heading"
      >
        <div className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
            Verified archive state
          </p>
          <h2 id="archive-boundary-heading" className="mt-2 text-2xl">
            Operational boundary
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            This desk reports persisted records and saved links. It does not simulate a running
            agent or invent activity beyond the archive.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-4">
            <BoundaryMetric label="Records" value={records.length} />
            <BoundaryMetric label="Links" value={linksPending || linksError ? "—" : links.length} />
            <BoundaryMetric label="Needs review" value={model.attentionCount} />
            <BoundaryMetric label="Recent" value={model.recentItems.length} />
          </dl>
        </div>
        <div className="border-t border-strong-border bg-[color:var(--canvas)] p-5 lg:border-l lg:border-t-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">Boundary</p>
          <p className="mt-3 font-serif text-lg text-foreground">
            {isFetching
              ? "Retrieving persisted state"
              : online
                ? "Archive available"
                : "Cached view only"}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {lastSuccessfulSync
              ? `Last verified ${formatArchiveDateTime(lastSuccessfulSync)}`
              : "No verified sync in this session."}
          </p>
          <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            Mutations remain owner-initiated. Provider-disabled features remain inactive.
          </p>
        </div>
      </section>

      <div className="space-y-2">
        {!online ? (
          <OperationalNotice tone="risk" title="Offline">
            Cached archive material may remain visible. Intake and mutation stay disabled.
          </OperationalNotice>
        ) : null}
        {linksError ? (
          <OperationalNotice tone="risk" title="Relationship evidence unavailable">
            <span>
              Record content is usable, but connection counts and provenance paths are incomplete.
            </span>
            <button type="button" className="text-white-gold underline" onClick={onRetry}>
              Retry
            </button>
          </OperationalNotice>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>
            {isFetching ? "Retrieving archive" : online ? "Archive ready" : "Archive cached"}
          </span>
          <span>
            {lastSuccessfulSync
              ? `Last verified ${formatArchiveDateTime(lastSuccessfulSync)}`
              : "No verified sync in this session"}
          </span>
        </div>
      </div>

      <section aria-labelledby="judgment-queue-heading" className="custodian-rule-section">
        <SectionHeading
          id="judgment-queue-heading"
          title="Review queue"
          value={model.attentionCount}
          action={{ to: "/inbox", label: "Open inbox" }}
        />
        {model.attentionItems.length ? (
          <>
            <div className="divide-y divide-border md:hidden">
              {model.attentionItems.map((item, index) => (
                <Link key={item.record.id} to={recordHref(item.record)} className="grid gap-2 py-4">
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary bg-burgundy-muted font-mono text-xs text-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <TypeIcon type={item.record.recordType} />
                    <span className="line-clamp-2 min-w-0 flex-1 font-serif text-[15px] text-foreground">
                      {item.record.title}
                    </span>
                    <span className="font-mono text-[11px] text-white-gold">
                      {item.linkedCount}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.context || "No summary recorded."}
                  </span>
                  <span className="flex items-center justify-between gap-3">
                    <span className="custodian-risk-label">{item.status}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatArchiveDate(item.date)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="custodian-table min-w-[760px]">
                <thead>
                  <tr>
                    <th aria-label="Priority number">No.</th>
                    <th>Record</th>
                    <th>Reason in view</th>
                    <th>State</th>
                    <th>Evidence</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {model.attentionItems.map((item, index) => (
                    <tr key={item.record.id}>
                      <td className="font-mono text-sm font-semibold text-primary">
                        {String(index + 1).padStart(2, "0")}
                      </td>
                      <td>
                        <Link
                          to={recordHref(item.record)}
                          className="group flex items-center gap-3"
                        >
                          <TypeIcon type={item.record.recordType} />
                          <span>
                            <span className="line-clamp-2 font-serif text-[15px] text-foreground group-hover:text-white-gold">
                              {item.record.title}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {RECORD_TYPE_LABEL[item.record.recordType]}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-[28rem] text-muted-foreground">
                        <span className="line-clamp-3">
                          {item.context || "No summary recorded."}
                        </span>
                      </td>
                      <td>
                        <span className="custodian-risk-label">{item.status}</span>
                      </td>
                      <td className="font-mono text-white-gold">{item.linkedCount}</td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {formatArchiveDate(item.date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyRule>No archive records currently meet the existing attention rules.</EmptyRule>
        )}
      </section>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <section aria-labelledby="working-sets-heading" className="custodian-rule-section">
          <SectionHeading
            id="working-sets-heading"
            title="Default working sets"
            value={workingSets.reduce((sum, set) => sum + set.count, 0)}
          />
          <div className="divide-y divide-border">
            {workingSets.map((set) => (
              <div key={set.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                <div>
                  <h3 className="font-serif text-base text-foreground">{set.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{set.description}</p>
                </div>
                <span className="font-mono text-lg text-white-gold">{set.count}</span>
              </div>
            ))}
          </div>
          <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            These counts come from existing conversation project routes. Persisted Custodian cases
            are available through the Cases surface when the case foundation is available.
          </p>
        </section>

        <section aria-labelledby="trace-heading" className="custodian-rule-section">
          <SectionHeading
            id="trace-heading"
            title="Evidence trace"
            value={linksPending || linksError ? "—" : links.length}
            action={{ to: "/graph", label: "Inspect graph" }}
          />
          {linksPending ? (
            <EmptyRule>Retrieving record relationships…</EmptyRule>
          ) : evidenceTrace.length ? (
            <ol className="custodian-trace">
              {evidenceTrace.map(({ link, source, target }) => (
                <li key={link.id}>
                  <Link to={recordHref(source!)} className="text-foreground hover:text-white-gold">
                    {source!.title}
                  </Link>
                  <span className="text-muted-foreground">linked evidence</span>
                  <Link to={recordHref(target!)} className="text-foreground hover:text-white-gold">
                    {target!.title}
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyRule>No record relationships are available in this view.</EmptyRule>
          )}
        </section>
      </div>

      <section aria-labelledby="activity-heading" className="custodian-rule-section">
        <SectionHeading
          id="activity-heading"
          title="Recent archive activity"
          value={model.recentItems.length}
          action={{ to: "/timeline", label: "Open timeline" }}
        />
        <div className="divide-y divide-border">
          {model.recentItems.map((item) => (
            <Link
              key={item.record.id}
              to={recordHref(item.record)}
              className="grid gap-2 py-3 hover:text-white-gold sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
            >
              <CheckCircle size={17} className="text-luminous-gold" weight="fill" />
              <span className="min-w-0">
                <span className="block truncate font-serif text-[15px]">{item.record.title}</span>
                <span className="text-xs text-muted-foreground">Archive record updated</span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatArchiveDateTime(item.record.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function DeskLoading() {
  return (
    <div className="space-y-7 animate-pulse" role="status">
      <DeskHeading
        eyebrow="Operational brief"
        title="Custodian Desk"
        description="Assembling the archive state…"
      />
      {[160, 260, 180].map((height) => (
        <div key={height} className="border-y border-border bg-card/40" style={{ height }} />
      ))}
    </div>
  );
}

function DeskHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="border-b border-[color:var(--brass-muted)] pb-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-luminous-gold">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl text-white-gold sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </header>
  );
}

function SectionHeading({
  id,
  title,
  value,
  action,
}: {
  id: string;
  title: string;
  value: number | string;
  action?: { to: string; label: string };
}) {
  return (
    <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <h2 id={id} className="text-xl text-foreground">
        {title} <span className="ml-2 font-mono text-xs text-white-gold">{value}</span>
      </h2>
      {action ? (
        <Link
          to={action.to}
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-white-gold max-sm:w-full"
        >
          {action.label}
          <ArrowRight size={14} />
        </Link>
      ) : null}
    </header>
  );
}

function OperationalNotice({
  tone,
  title,
  children,
}: {
  tone: "risk" | "verified";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "risk" ? Warning : CheckCircle;
  return (
    <div
      className={
        tone === "risk"
          ? "custodian-notice custodian-notice-risk"
          : "custodian-notice custodian-notice-verified"
      }
    >
      <Icon size={17} weight="fill" />
      <strong>{title}</strong>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function EmptyRule({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-sm leading-6 text-muted-foreground">{children}</div>;
}

function buildWorkingSets(records: ArchiveRecord[]) {
  const routes = [
    ["The Forge", "Implementation, systems, and things being made."],
    ["The Chamber", "Judgment, adversarial review, and consequential decisions."],
    ["The Book", "Long-form synthesis and material meant to endure."],
    ["General", "Useful material not yet committed to a narrower working set."],
  ] as const;
  return routes.map(([name, description]) => ({
    name,
    description,
    count: records.filter(
      (record) => record.recordType === "conversation" && record.recordData.projectRoute === name,
    ).length,
  }));
}

function BoundaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card px-3 py-4">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-serif text-2xl text-foreground">{value}</dd>
    </div>
  );
}
