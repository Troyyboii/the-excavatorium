import { describe, expect, test } from "bun:test";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { buildTimeline, filterTimelineEvents, groupTimelineEvents } from "./-timeline-helpers";

function record(
  id: string,
  recordType: RecordType,
  createdAt: string,
  updatedAt: string,
): ArchiveRecord {
  return {
    id,
    recordType,
    title: id,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt,
    updatedAt,
    recordData: {} as never,
  } as ArchiveRecord;
}

const records = [
  record("conversation", "conversation", "2026-08-20T12:00:00.000Z", "2026-08-22T12:00:00.000Z"),
  record("decision", "decision", "2026-08-21T12:00:00.000Z", "2026-08-21T12:00:00.000Z"),
];

describe("timeline helpers", () => {
  test("creates created and updated events without duplicating unchanged timestamps", () => {
    const events = buildTimeline(records);

    expect(events).toHaveLength(3);
    expect(events.map(({ id }) => id)).toEqual([
      "conversation:updated",
      "decision:created",
      "conversation:created",
    ]);
  });

  test("filters by record type and event kind", () => {
    const events = buildTimeline(records);

    expect(
      filterTimelineEvents(events, { recordType: "conversation", kind: "updated" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["conversation:updated"]);
    expect(filterTimelineEvents(events, { recordType: "all", kind: "created" })).toHaveLength(2);
  });

  test("groups events by the viewer's calendar date in descending order", () => {
    const groups = groupTimelineEvents(buildTimeline(records));

    expect(groups.map(({ dateKey, events }) => [dateKey, events.length])).toEqual([
      ["2026-08-22", 1],
      ["2026-08-21", 1],
      ["2026-08-20", 1],
    ]);
  });
});
