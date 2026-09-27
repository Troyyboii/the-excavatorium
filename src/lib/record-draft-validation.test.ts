import { describe, expect, test } from "bun:test";
import { emptyRecordData } from "./types";
import { validateRecordDraft } from "./record-draft-validation";
import type { ArchiveRecord, ConversationData, DecisionData } from "./types";

describe("validateRecordDraft", () => {
  test("a conversation needs only a title and is never validated as a document", () => {
    const data = emptyRecordData("conversation", "2026-01-01") as ConversationData;
    expect(data.projectRoute).toBeNull();
    expect(validateRecordDraft("conversation", "Plain conversation", data)).toEqual([]);
    expect(
      validateRecordDraft("conversation", "Routed", {
        ...data,
        projectRoute: "Kitchen renovation",
      }),
    ).toEqual([]);
    expect(validateRecordDraft("conversation", "  ", data)).toEqual(["Title is required."]);
  });

  test("documents are still validated against the document schema", () => {
    const data = emptyRecordData("document", "2026-01-01");
    expect(validateRecordDraft("document", "Doc", data)).toEqual([]);
    const broken = { ...data, highSignalFindings: "not an array" } as never;
    expect(validateRecordDraft("document", "Doc", broken).length).toBeGreaterThan(0);
  });

  test("other record types keep their required fields", () => {
    expect(validateRecordDraft("tool", "T", emptyRecordData("tool", "2026-01-01"))).toEqual([
      "Category is required.",
    ]);
    expect(
      validateRecordDraft("repository", "R", emptyRecordData("repository", "2026-01-01")),
    ).toEqual(["GitHub URL is required."]);
    expect(validateRecordDraft("decision", "D", emptyRecordData("decision", "2026-01-01"))).toEqual(
      ["Reason is required."],
    );
  });

  test("rejects a supersession cycle when peer decisions are provided", () => {
    const a = {
      id: "a",
      recordType: "decision",
      title: "A",
      summary: "",
      tags: [],
      isExample: false,
      seedKey: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      recordData: {
        ...(emptyRecordData("decision", "2026-01-01") as DecisionData),
        reason: "A",
        supersedesDecisionId: "b",
      },
    } satisfies ArchiveRecord;
    const bData = {
      ...(emptyRecordData("decision", "2026-01-01") as DecisionData),
      reason: "B",
      supersedesDecisionId: "a",
    };
    const byId = new Map<string, ArchiveRecord>([
      ["a", a],
      [
        "b",
        {
          ...a,
          id: "b",
          title: "B",
          recordData: bData,
        },
      ],
    ]);
    expect(validateRecordDraft("decision", "B", bData, "b", byId)).toEqual([
      "Supersedes cannot create a cycle with other Decisions.",
    ]);
  });
});
