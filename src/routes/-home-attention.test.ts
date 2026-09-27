import { describe, expect, test } from "bun:test";
import { CHAMBERS, countWord, groupAttention, homeGreeting } from "./-home-helpers";
import {
  emptyConversationData,
  emptyDocumentData,
  emptyRepositoryData,
  emptyToolData,
  RECORD_TYPES,
  type ArchiveRecord,
  type BaseArchiveRecord,
  type ToolStatus,
} from "@/lib/types";

function base(id: string, updatedAt: string): Omit<BaseArchiveRecord, "recordType"> {
  return {
    id,
    title: `Record ${id}`,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt,
  };
}
const uncertainDoc = (id: string, updatedAt: string): ArchiveRecord => ({
  ...base(id, updatedAt),
  recordType: "document",
  recordData: {
    ...emptyDocumentData,
    uncertainties: [{ text: "Unclear", sourceReferenceIds: [] }],
  },
});
const settledDoc = (id: string): ArchiveRecord => ({
  ...base(id, "2026-08-02T10:00:00.000Z"),
  recordType: "document",
  recordData: { ...emptyDocumentData },
});
const openConversation = (id: string): ArchiveRecord => ({
  ...base(id, "2026-08-03T10:00:00.000Z"),
  recordType: "conversation",
  recordData: { ...emptyConversationData, openLoops: "Follow up" },
});
const tool = (id: string, status: ToolStatus): ArchiveRecord => ({
  ...base(id, "2026-08-04T10:00:00.000Z"),
  recordType: "tool",
  recordData: { ...emptyToolData, status },
});
const repository = (id: string): ArchiveRecord => ({
  ...base(id, "2026-08-05T10:00:00.000Z"),
  recordType: "repository",
  recordData: { ...emptyRepositoryData },
});

describe("groupAttention", () => {
  test("groups identical reasons, largest first, and keeps every record newest first", () => {
    const groups = groupAttention([
      uncertainDoc("d1", "2026-08-01T10:00:00.000Z"),
      settledDoc("d2"),
      uncertainDoc("d3", "2026-08-09T10:00:00.000Z"),
      openConversation("c1"),
      tool("t1", "Active"),
    ]);
    expect(groups.map((group) => [group.key, group.count, group.reason])).toEqual([
      ["document-uncertain", 2, "documents are uncertain"],
      ["conversation-open", 1, "conversation left open"],
    ]);
    expect(groups[0].records.map((record) => record.id)).toEqual(["d3", "d1"]);
    expect([groups[0].glyph, groups[0].tone]).toEqual(["skull", "ember"]);
    expect([groups[1].glyph, groups[1].tone]).toEqual(["coffin", "spectre"]);
  });

  test("keeps different tool statuses and repositories apart", () => {
    const groups = groupAttention([
      tool("t1", "Worth revisiting"),
      tool("t2", "Experimental"),
      tool("t3", "Experimental"),
      repository("r1"),
    ]);
    expect(groups.map((group) => [group.count, group.reason])).toEqual([
      [2, "tools are experimental"],
      [1, "repository awaits a verdict"],
      [1, "tool is worth revisiting"],
    ]);
  });

  test("is empty when nothing is flagged", () => {
    expect(groupAttention([settledDoc("d1"), tool("t1", "Buried")])).toEqual([]);
  });
});

describe("homeGreeting", () => {
  test("speaks the live attention count", () => {
    expect(homeGreeting(47, 7).full).toBe(
      "Ah… the lantern stirs. You have returned, and the dust has not been idle. Seven records call for your eye — I have touched none of them.",
    );
    expect(homeGreeting(47, 7).short).toBe("Ah… you return. Seven records call for your eye.");
    expect(homeGreeting(3, 1).full).toContain("One record calls for your eye");
    expect(homeGreeting(40, 23).short).toBe("Ah… you return. 23 records call for your eye.");
  });

  test("has quiet lines for a calm or empty Archive", () => {
    expect(homeGreeting(5, 0).short).toBe("Ah… you return. Nothing calls for your eye.");
    expect(homeGreeting(0, 0).full).toContain("empty shelves");
  });

  test("counts in words up to twelve", () => {
    expect([countWord(0), countWord(12), countWord(13)]).toEqual(["no", "twelve", "13"]);
  });
});

describe("CHAMBERS", () => {
  test("covers every record type once", () => {
    expect(CHAMBERS.map((chamber) => chamber.type).sort()).toEqual([...RECORD_TYPES].sort());
  });
});
