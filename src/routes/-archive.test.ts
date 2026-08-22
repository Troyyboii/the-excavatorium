import { describe, expect, test } from "bun:test";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { buildArchiveDirectory } from "./-archive-helpers";

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

describe("buildArchiveDirectory", () => {
  test("returns all five record classes with real counts and latest updates", () => {
    const summaries = buildArchiveDirectory([
      record(
        "conversation-old",
        "conversation",
        "2026-08-01T10:00:00.000Z",
        "2026-08-02T10:00:00.000Z",
      ),
      record(
        "conversation-new",
        "conversation",
        "2026-08-03T10:00:00.000Z",
        "2026-08-07T10:00:00.000Z",
      ),
      record("tool", "tool", "2026-08-04T10:00:00.000Z", "2026-08-05T10:00:00.000Z"),
    ]);

    expect(Object.keys(summaries)).toHaveLength(5);
    expect(summaries.conversation).toMatchObject({
      recordType: "conversation",
      count: 2,
      latestUpdatedAt: "2026-08-07T10:00:00.000Z",
    });
    expect(summaries.tool).toMatchObject({
      recordType: "tool",
      count: 1,
      latestUpdatedAt: "2026-08-05T10:00:00.000Z",
    });
    expect(summaries.document).toMatchObject({
      recordType: "document",
      count: 0,
      latestUpdatedAt: null,
    });
  });
});
