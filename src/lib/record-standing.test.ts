import { describe, expect, test } from "bun:test";
import { recordStanding, standingSign, STANDING_KINDS } from "./record-standing";
import {
  emptyConversationData,
  emptyDocumentData,
  emptyRepositoryData,
  emptyToolData,
  REPOSITORY_ACTIONS,
  TOOL_STATUSES,
  type ArchiveRecord,
  type BaseArchiveRecord,
  type DecisionStatus,
  type RepositoryAction,
  type ToolStatus,
} from "./types";

const base: Omit<BaseArchiveRecord, "recordType"> = {
  id: "record",
  title: "Record",
  summary: "",
  tags: [],
  isExample: false,
  seedKey: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

const tool = (status: ToolStatus): ArchiveRecord => ({
  ...base,
  recordType: "tool",
  recordData: { ...emptyToolData, status },
});
const decision = (status: DecisionStatus): ArchiveRecord => ({
  ...base,
  recordType: "decision",
  recordData: {
    reason: "",
    trigger: "",
    whatWouldChangeMyMind: "",
    decisionDate: "2026-08-01",
    status,
    confidence: "High",
    supersedesDecisionId: null,
  },
});
const conversation = (openLoops: string): ArchiveRecord => ({
  ...base,
  recordType: "conversation",
  recordData: { ...emptyConversationData, openLoops },
});
const document = (uncertain: boolean): ArchiveRecord => ({
  ...base,
  recordType: "document",
  recordData: {
    ...emptyDocumentData,
    uncertainties: uncertain ? [{ text: "Unclear source", sourceReferenceIds: [] }] : [],
  },
});
const repository = (recommendedAction: RepositoryAction | null): ArchiveRecord => ({
  ...base,
  recordType: "repository",
  recordData: { ...emptyRepositoryData, recommendedAction },
});

describe("recordStanding", () => {
  test("tools keep their status as the label", () => {
    const expected: Record<ToolStatus, [string, string, string]> = {
      Active: ["current", "candle", "candle"],
      "Useful but dormant": ["awaiting", "hourglass", "mist"],
      Experimental: ["awaiting", "hourglass", "mist"],
      "Worth revisiting": ["awaiting", "hourglass", "mist"],
      Disappointing: ["superseded", "toppled", "ash"],
      Buried: ["buried", "mound", "ash"],
      "Grok-tier cursed": ["buried", "mound", "ash"],
    };
    for (const status of TOOL_STATUSES) {
      const standing = recordStanding(tool(status));
      expect([standing.kind, standing.glyph, standing.tone]).toEqual(expected[status]);
      expect(standing.label).toBe(status);
    }
  });

  test("decisions map every status", () => {
    expect(recordStanding(decision("Current"))).toEqual({
      kind: "current",
      label: "Current",
      glyph: "candle",
      tone: "candle",
    });
    expect(recordStanding(decision("Tentative"))).toEqual({
      kind: "awaiting",
      label: "Tentative",
      glyph: "hourglass",
      tone: "mist",
    });
    expect(recordStanding(decision("Superseded"))).toEqual({
      kind: "superseded",
      label: "Superseded",
      glyph: "toppled",
      tone: "ash",
    });
    expect(recordStanding(decision("Reversed"))).toEqual({
      kind: "superseded",
      label: "Reversed",
      glyph: "toppled",
      tone: "ash",
    });
    expect(recordStanding(decision("Archived"))).toEqual({
      kind: "buried",
      label: "Archived",
      glyph: "mound",
      tone: "ash",
    });
  });

  test("conversations with open loops stay open; blank loops do not count", () => {
    expect(recordStanding(conversation("Ask again next week"))).toEqual({
      kind: "open-loop",
      label: "Open loop",
      glyph: "coffin",
      tone: "spectre",
    });
    expect(recordStanding(conversation("   ")).kind).toBe("current");
    expect(recordStanding(conversation("")).label).toBe("Current");
  });

  test("documents with saved uncertainties are uncertain", () => {
    expect(recordStanding(document(true))).toEqual({
      kind: "uncertain",
      label: "Uncertain",
      glyph: "skull",
      tone: "ember",
    });
    expect(recordStanding(document(false))).toEqual({
      kind: "current",
      label: "Current",
      glyph: "candle",
      tone: "candle",
    });
  });

  test("repositories without a verdict await one; Skip and Pour down sink are buried", () => {
    expect(recordStanding(repository(null))).toEqual({
      kind: "awaiting",
      label: "Awaiting verdict",
      glyph: "hourglass",
      tone: "mist",
    });
    for (const action of REPOSITORY_ACTIONS) {
      const standing = recordStanding(repository(action));
      expect(standing.label).toBe(action);
      expect(standing.kind).toBe(
        action === "Skip" || action === "Pour down sink" ? "buried" : "current",
      );
    }
  });

  test("every standing has a generic sign", () => {
    expect(STANDING_KINDS.map((kind) => standingSign(kind).label)).toEqual([
      "Current",
      "Open loop",
      "Uncertain",
      "Awaiting verdict",
      "Superseded",
      "Buried",
    ]);
  });
});
