import { describe, expect, test } from "bun:test";
import type { InboxItem, InboxStatus } from "./custodian-types";
import {
  countInboxStatuses,
  displayJson,
  filterInboxItems,
  INBOX_FILTERS,
  isPromotionReady,
  parseWorkingSet,
  serializeWorkingSetEntry,
} from "./custodian-surfaces";

function inboxItem(id: string, status: InboxStatus): InboxItem {
  return {
    id,
    kind: "thought",
    rawContent: id,
    title: id,
    candidate: {},
    status,
    sourceLabel: "thought",
    capturedAt: "2026-08-11T12:00:00.000Z",
    triagedAt: null,
    promotedKind: null,
    promotedId: null,
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-08-11T12:00:00.000Z",
    updatedAt: "2026-08-11T12:00:00.000Z",
  };
}

describe("Custodian Inbox surface", () => {
  const items = [
    inboxItem("new", "new"),
    inboxItem("triaged", "triaged"),
    inboxItem("promoted", "promoted"),
    inboxItem("dismissed", "dismissed"),
    inboxItem("archived", "archived"),
  ];

  test("keeps every persisted lifecycle state filterable and countable", () => {
    expect(INBOX_FILTERS).toEqual(["all", "new", "triaged", "promoted", "dismissed", "archived"]);
    expect(filterInboxItems(items, "dismissed").map((item) => item.id)).toEqual(["dismissed"]);
    expect(filterInboxItems(items, "all")).toHaveLength(5);
    expect(countInboxStatuses(items)).toEqual({
      new: 1,
      triaged: 1,
      promoted: 1,
      dismissed: 1,
      archived: 1,
    });
  });

  test("requires both a selected case and explicit confirmation before promotion", () => {
    expect(isPromotionReady({ caseId: "", confirmed: true, busy: false })).toBe(false);
    expect(isPromotionReady({ caseId: "case-1", confirmed: false, busy: false })).toBe(false);
    expect(isPromotionReady({ caseId: "case-1", confirmed: true, busy: true })).toBe(false);
    expect(isPromotionReady({ caseId: "case-1", confirmed: true, busy: false })).toBe(true);
  });
});

describe("Custodian Case surface", () => {
  test("normalizes the line-based working set without inventing entries", () => {
    expect(parseWorkingSet(' record-1 \n\nThe Forge\n {"source":"record-2"} ')).toEqual([
      "record-1",
      "The Forge",
      { source: "record-2" },
    ]);
    expect(displayJson({ source: "record-1" })).toBe('{"source":"record-1"}');
    expect(parseWorkingSet(serializeWorkingSetEntry("123"))).toEqual(["123"]);
    expect(parseWorkingSet(serializeWorkingSetEntry(true))).toEqual([true]);
  });
});
