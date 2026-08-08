import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  ClockCounterClockwise,
  LinkSimple,
  Warning,
} from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import {
  buildDashboardViewModel,
  type DashboardBreakdown,
  type DashboardRecordItem,
} from "@/lib/dashboard";
import { PageHeader } from "@/components/page-parts";
import { recordHref, TypeIcon } from "@/components/record-list";
import { RECORD_TYPE_LABEL } from "@/lib/types";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/")({ component: Dashboard, ssr: false });

function Dashboard() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const model = useMemo(
    () => (query.data ? buildDashboardViewModel(query.data.records, query.data.links) : null),
    [query.data],
  );

  if (!query.data && query.isPending) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Loading the archive command centre…" />
        <div className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-lg border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!query.data || !model) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <StateBanner kind="error" title="Archive could not load">
          <span>{query.recordsError?.message ?? "The records request failed."}</span>
          <button type="button" className="state-action" onClick={() => void query.refetch()}>
            Retry
          </button>
        </StateBanner>
      </div>
    );
  }

  return (
    <DashboardSurface
      model={model}
      online={online}
      recordsError={query.recordsError?.message ?? null}
      linksError={Boolean(query.linksError)}
      linksPending={query.state.linksPending}
      isFetching={query.isFetching}
      lastSuccessfulSync={query.state.lastSuccessfulSync}
      onRetry={() => void query.refetch()}
    />
  );
}

export function DashboardSurface({
  model,
  online,
  recordsError,
  linksError,
  linksPending,
  isFetching,
  lastSuccessfulSync,
  onRetry,
}: {
  model: ReturnType<typeof buildDashboardViewModel>;
  online: boolean;
  recordsError: string | null;
  linksError: boolean;
  linksPending: boolean;
  isFetching: boolean;
  lastSuccessfulSync: number | null;
  onRetry: () => void;
}) {
  return (
    <div>
      <PageHeader title="Dashboard" description="Operational overview of your archive." />

      <div className="mb-4 space-y-2">
        {!online ? (
          <StateBanner kind="warning" title="Offline">
            Archive data may be stale. Saving and conversation excavation stay disabled until the
            connection returns.
          </StateBanner>
        ) : null}
        {recordsError ? (
          <StateBanner kind="warning" title="Showing the last successful record load">
            <span>{recordsError}</span>
            <button type="button" className="ml-2 underline" onClick={onRetry}>
              Retry
            </button>
          </StateBanner>
        ) : null}
        {linksError ? (
          <StateBanner kind="warning" title="Connections unavailable">
            Records remain usable, but linked counts and isolated-record results may be incomplete.
          </StateBanner>
        ) : null}
        {isFetching ? (
          <div className="text-right text-xs text-muted-foreground" role="status">
            Updating archive…
          </div>
        ) : lastSuccessfulSync ? (
          <div className="text-right text-xs text-muted-foreground">
            Last synced {formatTimestamp(lastSuccessfulSync)}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<Archive size={25} />} value={model.totalRecords} label="Records in view" />
        <Metric
          icon={<Warning size={25} />}
          value={model.attentionCount}
          label="Needs attention"
          tone="warning"
        />
        <Metric
          icon={<LinkSimple size={25} />}
          value={linksPending || linksError ? "—" : model.connectedCount}
          label="Connected records"
        />
        <Metric
          icon={<ClockCounterClockwise size={25} />}
          value={model.recentCount}
          label="Updated in 7 days"
        />
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-5">
          <Panel title="Needs attention" count={model.attentionCount}>
            {model.attentionItems.length ? (
              <RecordTable items={model.attentionItems} statusTone="warning" />
            ) : (
              <PanelEmpty>No records currently need a verdict, review, or follow-up.</PanelEmpty>
            )}
          </Panel>

          <Panel title="Recent activity" count={model.recentItems.length}>
            {model.recentItems.length ? (
              <RecordTable items={model.recentItems} />
            ) : (
              <PanelEmpty>No activity exists in this view yet.</PanelEmpty>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Archive pulse">
            <Breakdown title="Record types" items={model.typeBreakdown} />
            <Breakdown
              title="Tool and decision states"
              items={model.statusBreakdown.slice(0, 6)}
              tone="burgundy"
            />
          </Panel>

          <Panel title="Connection health">
            {linksPending || linksError ? null : (
              <div className="grid grid-cols-2 border-b border-border">
                <ConnectionStat label="Connected" value={model.connectedCount} tone="brass" />
                <ConnectionStat label="Isolated" value={model.isolatedCount} tone="warning" />
              </div>
            )}
            {linksPending ? (
              <PanelEmpty>Loading connection health…</PanelEmpty>
            ) : linksError ? (
              <PanelEmpty>Connection details will return after links reload.</PanelEmpty>
            ) : model.isolatedRecords.length ? (
              <div className="divide-y divide-border">
                {model.isolatedRecords.slice(0, 4).map((record) => (
                  <Link
                    key={record.id}
                    to={recordHref(record)}
                    className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm hover:bg-[color:var(--record-hover)]"
                  >
                    <TypeIcon type={record.recordType} />
                    <span className="min-w-0 flex-1 truncate">{record.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {RECORD_TYPE_LABEL[record.recordType]}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <PanelEmpty>Every record in this view has at least one connection.</PanelEmpty>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
  tone = "brass",
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: "brass" | "warning";
}) {
  const toneClass =
    tone === "warning" ? "text-[color:var(--warning)]" : "text-[color:var(--brass)]";
  return (
    <div className="flex min-h-24 items-center gap-4 rounded-lg border border-border bg-card px-4 py-4">
      <div className={toneClass}>{icon}</div>
      <div>
        <div className="font-serif text-3xl leading-none text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header
        className={`flex min-h-12 border-b border-border px-4 py-3 ${
          action
            ? "flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
            : "items-center justify-between"
        }`}
      >
        <h2 className="font-serif text-lg text-foreground">
          {title}
          {typeof count === "number" && action ? (
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">{count}</span>
          ) : null}
        </h2>
        <div className="flex items-center gap-3">
          {typeof count === "number" && !action ? (
            <span className="font-mono text-xs text-muted-foreground">{count}</span>
          ) : null}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

function RecordTable({
  items,
  statusTone = "brass",
}: {
  items: DashboardRecordItem[];
  statusTone?: "brass" | "warning";
}) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <Link
          key={item.record.id}
          to={recordHref(item.record)}
          className="group grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--record-hover)] md:grid-cols-[auto_minmax(0,1fr)_150px_92px_50px]"
        >
          <TypeIcon type={item.record.recordType} size={18} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{item.record.title}</div>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {item.context || RECORD_TYPE_LABEL[item.record.recordType]}
            </p>
          </div>
          <ArrowRight size={16} className="text-muted-foreground md:hidden" />
          <span
            className={`hidden text-xs md:block ${
              statusTone === "warning" ? "text-[color:var(--warning)]" : "text-[color:var(--brass)]"
            }`}
          >
            {item.status}
          </span>
          <span className="hidden text-xs text-muted-foreground md:block">
            {formatDate(item.date)}
          </span>
          <span className="hidden items-center justify-end gap-1 text-xs text-muted-foreground md:flex">
            <LinkSimple size={13} /> {item.linkedCount}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Breakdown({
  title,
  items,
  tone = "brass",
}: {
  title: string;
  items: DashboardBreakdown[];
  tone?: "brass" | "burgundy";
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="border-b border-border p-4 last:border-0">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.key}>
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{item.label}</span>
                <span className="font-mono text-muted-foreground">{item.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--secondary)]">
                <div
                  className={`h-full rounded-full ${
                    tone === "burgundy" ? "bg-[color:var(--primary)]" : "bg-[color:var(--brass)]"
                  }`}
                  style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No status data in this view.</p>
        )}
      </div>
    </div>
  );
}

function ConnectionStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brass" | "warning";
}) {
  return (
    <div className="border-r border-border p-4 last:border-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`h-2 w-2 rounded-full ${
            tone === "brass" ? "bg-[color:var(--brass)]" : "bg-[color:var(--warning)]"
          }`}
        />
        {label}
      </div>
      <div className="mt-2 font-serif text-2xl text-foreground">{value}</div>
    </div>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="p-5 text-sm text-muted-foreground">{children}</p>;
}

function StateBanner({
  kind,
  title,
  children,
}: {
  kind: "warning" | "error";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
        kind === "error"
          ? "border-[color:var(--destructive)]/60 bg-[color:var(--destructive)]/10"
          : "border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10"
      }`}
      role={kind === "error" ? "alert" : "status"}
    >
      <div>
        <span className="font-medium text-foreground">{title}. </span>
        <span className="text-muted-foreground">{children}</span>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
