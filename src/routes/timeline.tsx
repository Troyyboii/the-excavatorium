import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { FilePlus, PencilSimple } from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import type { ArchiveRecord } from "@/lib/types";
import {
  CustodianPage,
  CustodianStatus,
  FoundationState,
  Section,
} from "@/components/custodian/custodian-ui";
import { archiveRecordHref, formatRecordDate } from "@/components/custodian/custodian-format";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/timeline")({ component: TimelinePage, ssr: false });

type TimelineEvent = {
  id: string;
  kind: "created" | "updated";
  at: string;
  record: ArchiveRecord;
};

function TimelinePage() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const events = useMemo(() => buildTimeline(query.data?.records ?? []), [query.data?.records]);
  return (
    <CustodianPage
      title="Timeline"
      description="Created and updated events from persisted records only. This is not an inferred activity feed."
      status={
        <CustodianStatus
          online={online}
          fetching={query.isFetching}
          foundationPending={!query.data && query.isPending}
          error={query.recordsError?.message ?? null}
        />
      }
    >
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
          action={`${events.length} event${events.length === 1 ? "" : "s"}`}
        >
          {events.length ? (
            <div className="divide-y divide-[#D5B56D]/15">
              {events.map((event) => (
                <TimelineRow key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <div className="p-5 text-sm text-[#9d9587]">
              No persisted record events in this view.
            </div>
          )}
        </Section>
      )}
    </CustodianPage>
  );
}

function buildTimeline(records: ArchiveRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const record of records) {
    if (record.createdAt)
      events.push({ id: `${record.id}:created`, kind: "created", at: record.createdAt, record });
    if (record.updatedAt && record.updatedAt !== record.createdAt) {
      events.push({ id: `${record.id}:updated`, kind: "updated", at: record.updatedAt, record });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon = event.kind === "created" ? FilePlus : PencilSimple;
  return (
    <a
      href={archiveRecordHref(event.record)}
      className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 transition-colors hover:bg-[#4a2029]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5B56D] sm:grid-cols-[auto_170px_minmax(0,1fr)_100px] sm:items-center"
    >
      <Icon size={17} className="text-[#D5B56D]" aria-hidden="true" />
      <time dateTime={event.at} className="hidden text-xs text-[#9d9587] sm:block">
        {formatRecordDate(event.at)}
      </time>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[#F0E3BE]">{event.record.title}</span>
        <span className="mt-1 block text-xs text-[#9d9587]">
          {event.kind} · {event.record.recordType}
        </span>
      </span>
      <span className="hidden text-right text-xs text-[#D5B56D] sm:block">{event.kind}</span>
      <time dateTime={event.at} className="text-xs text-[#9d9587] sm:hidden">
        {formatRecordDate(event.at)}
      </time>
    </a>
  );
}
