import { describe, expect, test } from "bun:test";
import { buildBackup, validateBackup } from "./format";
import type { ArchiveLink, ArchiveRecord } from "./types";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

const records: ArchiveRecord[] = [
  {
    id: firstId,
    recordType: "conversation",
    title: "Conversation",
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    recordData: {
      conversationDate: null,
      projectRoute: "General",
      highSignalFindings: "",
      decisionsMade: "",
      openLoops: "Follow up",
      reusablePrompts: "",
      memoryCandidates: "",
      rawConversationText: "",
    },
  },
  {
    id: secondId,
    recordType: "decision",
    title: "Decision",
    summary: "Validated decision",
    tags: ["Policy"],
    isExample: false,
    seedKey: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    recordData: {
      reason: "Evidence",
      trigger: "Review",
      whatWouldChangeMyMind: "New evidence",
      decisionDate: "2026-08-03",
      status: "Current",
      confidence: "High",
      supersedesDecisionId: null,
    },
  },
];

const links: ArchiveLink[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    sourceId: firstId,
    targetId: secondId,
    seedKey: null,
    createdAt: "2026-08-03T10:00:00.000Z",
  },
];

describe("backup export and restore validation", () => {
  test("round-trips a complete record-and-link snapshot", () => {
    const backup = buildBackup(records, links);
    const result = validateBackup(JSON.parse(JSON.stringify(backup)));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.counts.totalRecords).toBe(2);
      expect(result.counts.links).toBe(1);
    }
  });

  test("rejects a restore payload with an orphaned connection", () => {
    const backup = buildBackup(records, [
      { ...links[0], targetId: "44444444-4444-4444-8444-444444444444" },
    ]);
    const result = validateBackup(backup);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("targetId");
  });
});
