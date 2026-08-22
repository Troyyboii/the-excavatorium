import type { ArchiveRecord, RecordType } from "@/lib/types";

export type TimelineEventKind = "created" | "updated";
export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  at: string;
  record: ArchiveRecord;
};

export type TimelineEventKindFilter = TimelineEventKind | "all";
export type TimelineRecordTypeFilter = RecordType | "all";

export type TimelineFilters = {
  recordType: TimelineRecordTypeFilter;
  kind: TimelineEventKindFilter;
};

export type TimelineGroup = {
  dateKey: string;
  events: TimelineEvent[];
};

export function buildTimeline(records: ArchiveRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const record of records) {
    if (record.createdAt) {
      events.push({ id: `${record.id}:created`, kind: "created", at: record.createdAt, record });
    }
    if (record.updatedAt && record.updatedAt !== record.createdAt) {
      events.push({ id: `${record.id}:updated`, kind: "updated", at: record.updatedAt, record });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function filterTimelineEvents(
  events: TimelineEvent[],
  filters: TimelineFilters,
): TimelineEvent[] {
  return events.filter(
    (event) =>
      (filters.recordType === "all" || event.record.recordType === filters.recordType) &&
      (filters.kind === "all" || event.kind === filters.kind),
  );
}

export function groupTimelineEvents(events: TimelineEvent[]): TimelineGroup[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const dateKey = timelineDateKey(event.at);
    const group = groups.get(dateKey);
    if (group) {
      group.push(event);
    } else {
      groups.set(dateKey, [event]);
    }
  }

  return [...groups.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([dateKey, groupedEvents]) => ({ dateKey, events: groupedEvents }));
}

function timelineDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
