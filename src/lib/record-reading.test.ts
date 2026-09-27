import { describe, expect, test } from "bun:test";
import { custodianReadingLine, supersessionChain } from "./record-reading";
import {
  emptyToolData,
  type ArchiveRecord,
  type DecisionRecord,
  type DecisionStatus,
} from "./types";

function decision(
  id: string,
  status: DecisionStatus,
  supersedesDecisionId: string | null,
  decisionDate = "2026-07-12",
): DecisionRecord {
  return {
    id,
    recordType: "decision",
    title: id,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    recordData: {
      reason: "",
      trigger: "",
      whatWouldChangeMyMind: "",
      decisionDate,
      status,
      confidence: "High",
      supersedesDecisionId,
    },
  };
}

const tool: ArchiveRecord = {
  ...decision("tool", "Current", null),
  recordType: "tool",
  recordData: { ...emptyToolData },
};

describe("supersessionChain", () => {
  const restrict = decision("restrict", "Superseded", null);
  const stop = decision("stop", "Current", "restrict", "2026-07-18");
  const later = decision("later", "Current", "restrict", "2026-07-20");
  const dangling = decision("dangling", "Current", "missing");
  const all = [restrict, stop, later, dangling, tool];
  const byId = new Map(all.map((record) => [record.id, record]));

  test("finds the decisions that replaced this one, newest first", () => {
    expect(supersessionChain(restrict, all, byId).replacedBy.map((item) => item.id)).toEqual([
      "later",
      "stop",
    ]);
    expect(supersessionChain(restrict, all, byId).replaces).toBeNull();
  });

  test("finds the decision this one replaced, ignoring missing targets", () => {
    expect(supersessionChain(stop, all, byId).replaces?.id).toBe("restrict");
    expect(supersessionChain(dangling, all, byId)).toEqual({ replaces: null, replacedBy: [] });
  });

  test("is empty for other record types", () => {
    expect(supersessionChain(tool, all, byId)).toEqual({ replaces: null, replacedBy: [] });
  });
});

describe("custodianReadingLine", () => {
  test("matches the canvas line for an unread superseded decision", () => {
    expect(custodianReadingLine("superseded", 0, true)).toBe(
      "Set aside, yet it still bears witness to what came after. I have not read it. Bid me, and I shall.",
    );
  });

  test("never claims a reading it cannot confirm", () => {
    expect(custodianReadingLine("current", undefined, false)).toBe(
      "It stands, and it still holds.",
    );
    expect(custodianReadingLine("open-loop", 2, false)).toContain("I have read it before");
    expect(custodianReadingLine("buried", 1, true)).toContain("Bid me, and I shall read it again.");
  });
});
