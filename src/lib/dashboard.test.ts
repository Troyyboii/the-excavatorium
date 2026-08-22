import { describe, expect, test } from "bun:test";
import { buildDashboardViewModel } from "./dashboard";
import type { ArchiveLink, ArchiveRecord, BaseArchiveRecord } from "./types";

function base(id: string, title: string, isExample = false): Omit<BaseArchiveRecord, "recordType"> {
  return {
    id,
    title,
    summary: "",
    tags: [],
    isExample,
    seedKey: isExample ? `seed-${id}` : null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
  };
}

const records: ArchiveRecord[] = [
  {
    ...base("conversation", "Open conversation"),
    recordType: "conversation",
    recordData: {
      conversationDate: null,
      projectRoute: "General",
      highSignalFindings: "",
      decisionsMade: "",
      openLoops: "Answer the remaining question",
      reusablePrompts: "",
      memoryCandidates: "",
      rawConversationText: "",
    },
  },
  {
    ...base("repository", "Awaiting repository"),
    recordType: "repository",
    recordData: {
      githubUrl: "https://github.com/example/repo",
      whatCaughtMyEye: "",
      whatItClaims: "",
      whatItActuallyDoes: "",
      maintenanceImpression: "",
      complexity: "Unknown",
      risk: "Unknown",
      integrationCost: "Unknown",
      immediateUsefulness: "Unknown",
      longTermValue: "Unknown",
      recommendedAction: null,
      finalVerdict: "",
      lastReviewed: null,
    },
  },
  {
    ...base("decision", "Example decision", true),
    recordType: "decision",
    recordData: {
      reason: "Seed reason",
      trigger: "",
      whatWouldChangeMyMind: "",
      decisionDate: "2025-01-01",
      status: "Tentative",
      confidence: "Medium",
      supersedesDecisionId: null,
    },
  },
];

const links: ArchiveLink[] = [
  {
    id: "link-1",
    sourceId: "conversation",
    targetId: "repository",
    seedKey: null,
    createdAt: "2026-08-07T10:00:00.000Z",
  },
  {
    id: "link-2",
    sourceId: "repository",
    targetId: "decision",
    seedKey: null,
    createdAt: "2026-08-07T10:00:00.000Z",
  },
];

describe("buildDashboardViewModel", () => {
  test("treats every archive entry as a first-party record", () => {
    const model = buildDashboardViewModel(records, links, new Date("2026-08-08"));
    expect(model.totalRecords).toBe(3);
    expect(model.attentionCount).toBe(3);
    expect(model.connectedCount).toBe(3);
    expect(model.isolatedCount).toBe(0);
    expect(model.attentionItems.some((item) => item.record.isExample)).toBe(true);
    expect(model.typeBreakdown.find((item) => item.key === "decision")?.count).toBe(1);
    expect(model.statusBreakdown.find((item) => item.key === "decision-Tentative")?.count).toBe(1);
  });

  test("keeps authored decision date as metadata while sorting activity by updated time", () => {
    const model = buildDashboardViewModel(records, links, new Date("2026-08-08"));
    const decision = model.recentItems.find((item) => item.record.id === "decision");
    expect(decision?.date).toBe("2025-01-01");
    expect(model.recentItems[0]?.record.title).toBe("Awaiting repository");
  });

  test("excludes records older than seven days from recent activity", () => {
    const staleRecord: ArchiveRecord = {
      ...records[0],
      id: "stale-conversation",
      title: "Stale conversation",
      updatedAt: "2026-07-31T23:59:59.000Z",
    };

    const model = buildDashboardViewModel(
      [...records, staleRecord],
      links,
      new Date("2026-08-08T12:00:00.000Z"),
    );

    expect(model.recentCount).toBe(3);
    expect(model.recentItems.map((item) => item.record.id)).not.toContain("stale-conversation");
  });
});
