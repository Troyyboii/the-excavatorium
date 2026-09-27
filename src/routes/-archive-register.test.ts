import { describe, expect, test } from "bun:test";
import {
  archiveCustodianLine,
  filterArchive,
  numberInWords,
  parseArchiveFilters,
} from "./-archive-helpers";
import {
  emptyConversationData,
  emptyDocumentData,
  emptyToolData,
  type ArchiveRecord,
  type BaseArchiveRecord,
} from "@/lib/types";

function base(id: string, title: string, updatedAt: string): Omit<BaseArchiveRecord, "recordType"> {
  return {
    id,
    title,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt,
  };
}

const records: ArchiveRecord[] = [
  {
    ...base("doc", "Evidence brief", "2026-09-22T10:00:00.000Z"),
    recordType: "document",
    recordData: {
      ...emptyDocumentData,
      uncertainties: [{ text: "Source unclear", sourceReferenceIds: [] }],
    },
  },
  {
    ...base("codex", "Codex", "2026-09-17T10:00:00.000Z"),
    recordType: "tool",
    recordData: { ...emptyToolData, status: "Active", finalVerdict: "Keeps up with the repo" },
  },
  {
    ...base("mem0", "Mem0", "2026-09-17T10:00:00.000Z"),
    recordType: "tool",
    recordData: { ...emptyToolData, status: "Buried" },
  },
  {
    ...base("talk", "Memo and Replit", "2026-09-18T10:00:00.000Z"),
    recordType: "conversation",
    recordData: { ...emptyConversationData, openLoops: "Ask about pricing" },
  },
];

describe("filterArchive", () => {
  test("sorts newest first, then by title", () => {
    expect(filterArchive(records, {}).map((record) => record.id)).toEqual([
      "doc",
      "talk",
      "codex",
      "mem0",
    ]);
  });

  test("narrows by chamber, standing and text together", () => {
    expect(filterArchive(records, { type: "tool" }).map((record) => record.id)).toEqual([
      "codex",
      "mem0",
    ]);
    expect(filterArchive(records, { standing: "buried" }).map((record) => record.id)).toEqual([
      "mem0",
    ]);
    expect(filterArchive(records, { standing: "open-loop" }).map((record) => record.id)).toEqual([
      "talk",
    ]);
    expect(filterArchive(records, { q: "PRICING" }).map((record) => record.id)).toEqual(["talk"]);
    expect(filterArchive(records, { q: "repo" }).map((record) => record.id)).toEqual(["codex"]);
    expect(filterArchive(records, { type: "tool", standing: "uncertain" })).toEqual([]);
  });
});

describe("parseArchiveFilters", () => {
  test("keeps only known filters", () => {
    expect(parseArchiveFilters({ type: "tool", standing: "buried", q: "mem" })).toEqual({
      type: "tool",
      standing: "buried",
      q: "mem",
    });
    expect(parseArchiveFilters({ type: "tools", standing: "cursed", q: "" })).toEqual({});
    expect(parseArchiveFilters({ q: 4 })).toEqual({});
  });
});

describe("Archive Custodian line", () => {
  test("speaks the live total in words", () => {
    expect(archiveCustodianLine(47)).toBe(
      "Forty-seven remains, catalogued. None forgotten — only unread.",
    );
    expect(archiveCustodianLine(1)).toBe(
      "One remnant, catalogued. Nothing forgotten — only unread.",
    );
    expect(archiveCustodianLine(0)).toContain("No remains yet");
  });

  test("counts in words to 999", () => {
    expect([0, 13, 40, 47, 100, 312, 999, 1000].map(numberInWords)).toEqual([
      "no",
      "thirteen",
      "forty",
      "forty-seven",
      "one hundred",
      "three hundred and twelve",
      "nine hundred and ninety-nine",
      "1000",
    ]);
  });
});
