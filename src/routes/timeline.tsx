import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowUpRight, FilePlus, PencilSimple } from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import { RECORD_TYPE_LABEL, RECORD_TYPES } from "@/lib/types";
import { formatArchiveDate, formatArchiveDateTime } from "@/lib/date-format";
import {
  CustodianPage,
  CustodianStatus,
  FoundationState,
  Section,
} from "@/components/custodian/custodian-ui";
import { archiveRecordHref } from "@/components/custodian/custodian-format";
import { useOnlineStatus } from "@/hooks/use-online";
import { ArchiveViewNav } from "@/components/archive-view-nav";
import {
  buildTimeline,
  filterTimelineEvents,
  groupTimelineEvents,
  type TimelineEvent,
  type TimelineEventKindFilter,
  type TimelineGroup,
  type TimelineRecordTypeFilter,
} from "./-timeline-helpers";

export const Route = createFileRoute("/timeline")({ component: TimelinePage, ssr: false });

function TimelinePage() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const [recordType, setRecordType] = useState<TimelineRecordTypeFilter>("all");
  const [kind, setKind] = useState<TimelineEventKindFilter>("all");
  const events = useMemo(() => buildTimeline(query.data?.records ?? []), [query.data?.records]);
  const visibleEvents = useMemo(
    () => filterTimelineEvents(events, { recordType, kind }),
    [events, kind, recordType],
  );
  const groups = useMemo(() => groupTimelineEvents(visibleEvents), [visibleEvents]);
  const hasFilters = recordType !== "all" || kind !== "all";

  return (
    <CustodianPage
      title="Archive timeline"
      description="Created and updated events from persisted records, grouped by date. This is not an inferred activity feed."
      status={
        <CustodianStatus
          online={online}
          fetching={query.isFetching}
          foundationPending={!query.data && query.isPending}
          error={query.recordsError?.message ?? null}
        />
      }
    >
      <ArchiveViewNav active="timeline" />
      {!query.data ? (
        <FoundationState
          title={query.isPending ? "Retrieving record events" : "Timeline retrieval blocked"}
        >
          {query.isPending
            ? "Reading persisted record timestamps…"
            : (query.recordsError?.message ?? "The archive returned no record data.")}
        </FoundationState>
      ) : (
        <Section
          title="Record events"
          description="Scope: record created_at and updated_at fields."
          action={`${visibleEvents.length} of ${events.length} event${events.length === 1 ? "" : "s"}`}
        >
          <TimelineFilterBar
            recordType={recordType}
            kind={kind}
            onRecordTypeChange={setRecordType}
            onKindChange={setKind}
            onReset={() => {
              setRecordType("all");
              setKind("all");
            }}
          />
          {groups.length ? (
            <div>
              {groups.map((group) => (
                <TimelineGroupRows key={group.dateKey} group={group} />
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-sm leading-6 text-muted-foreground">
              {hasFilters ? (
                <>
                  No persisted events match these filters.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setRecordType("all");
                      setKind("all");
                    }}
                    className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                "No persisted record events in this view."
              )}
            </div>
          )}
        </Section>
      )}
    </CustodianPage>
  );
}

function TimelineFilterBar({
  recordType,
  kind,
  onRecordTypeChange,
  onKindChange,
  onReset,
}: {
  recordType: TimelineRecordTypeFilter;
  kind: TimelineEventKindFilter;
  onRecordTypeChange: (value: TimelineRecordTypeFilter) => void;
  onKindChange: (value: TimelineEventKindFilter) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-card/60 p-4 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 border border-input bg-background px-3 py-2 text-sm text-foreground sm:min-w-56">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Record type</span>
        <select
          value={recordType}
          onChange={(event) => onRecordTypeChange(event.target.value as TimelineRecordTypeFilter)}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          aria-label="Filter timeline by record type"
        >
          <option value="all">All record types</option>
          {RECORD_TYPES.map((type) => (
            <option key={type} value={type}>
              {RECORD_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 border border-input bg-background px-3 py-2 text-sm text-foreground sm:min-w-48">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Event</span>
        <select
          value={kind}
          onChange={(event) => onKindChange(event.target.value as TimelineEventKindFilter)}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          aria-label="Filter timeline by event"
        >
          <option value="all">Created and updated</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
      </label>
      {recordType !== "all" || kind !== "all" ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex min-h-11 items-center justify-center border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-record-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function TimelineGroupRows({ group }: { group: TimelineGroup }) {
  const headingId = `timeline-${group.dateKey}`;
  return (
    <section aria-labelledby={headingId}>
      <header className="flex items-center justify-between gap-3 border-b border-border bg-secondary/55 px-4 py-2">
        <h3
          id={headingId}
          className="font-mono text-xs font-medium tracking-[0.12em] text-foreground"
        >
          <time dateTime={group.dateKey}>{formatArchiveDate(group.dateKey)}</time>
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {group.events.length} event{group.events.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="divide-y divide-border">
        {group.events.map((event) => (
          <TimelineRow key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon = event.kind === "created" ? FilePlus : PencilSimple;
  const kindTone = event.kind === "created" ? "text-verified" : "text-luminous-gold";
  return (
    <Link
      to={archiveRecordHref(event.record)}
      className="group grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-record-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold sm:grid-cols-[auto_170px_minmax(0,1fr)_auto_auto] sm:gap-4"
    >
      <span className={`flex h-8 w-8 items-center justify-center border border-border ${kindTone}`}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <time dateTime={event.at} className="hidden text-xs text-muted-foreground sm:block">
        {formatArchiveDateTime(event.at)}
      </time>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
          {event.record.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{RECORD_TYPE_LABEL[event.record.recordType]}</span>
          <span aria-hidden="true">·</span>
          <span className={kindTone}>{event.kind}</span>
          <time dateTime={event.at} className="sm:hidden">
            {formatArchiveDateTime(event.at)}
          </time>
        </span>
      </span>
      <span className={`hidden text-right text-xs font-medium capitalize sm:block ${kindTone}`}>
        {event.kind}
      </span>
      <ArrowUpRight
        size={17}
        className="text-luminous-gold transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
