import { describe, expect, test } from "bun:test";
import type { CustodianFinding, FindingStatus } from "./custodian-types";
import { investigationTrail, isFeaturedFindingEligible, orderFindings } from "./investigation-view";

describe("investigationTrail", () => {
  test("reads each step from persisted state", () => {
    expect(
      investigationTrail({ currentQuestion: "Does it hold?", evidenceCount: 1, findingCount: 2 }),
    ).toEqual([
      { key: "question", label: "Question", detail: "Framed", done: true },
      { key: "evidence", label: "Evidence", detail: "1 record", done: true },
      { key: "examined", label: "Examined", detail: "By the Custodian", done: true },
      { key: "judgment", label: "Your judgment", detail: "Waiting on you", done: false },
    ]);
  });

  test("never marks unfinished steps done", () => {
    const steps = investigationTrail({ currentQuestion: "  ", evidenceCount: 0, findingCount: 0 });
    expect(steps.map((step) => [step.detail, step.done])).toEqual([
      ["Not framed yet", false],
      ["0 records", false],
      ["Not yet", false],
      ["After examination", false],
    ]);
  });
});

describe("orderFindings", () => {
  const finding = (
    id: string,
    lifecycleStatus: "active" | "archived",
    status: FindingStatus,
    updatedAt: string,
  ) => ({ id, lifecycleStatus, status, updatedAt }) as unknown as CustodianFinding;

  test("puts eligible Findings first, newest first", () => {
    expect(
      orderFindings([
        finding("old-open", "active", "open", "2026-08-01T00:00:00.000Z"),
        finding("new-archived-lifecycle", "archived", "open", "2026-09-01T00:00:00.000Z"),
        finding("new-open", "active", "open", "2026-08-20T00:00:00.000Z"),
      ]).map((item) => item.id),
    ).toEqual(["new-open", "old-open", "new-archived-lifecycle"]);
  });

  test("superseded or archived status cannot displace a valid current Finding", () => {
    const ordered = orderFindings([
      finding("fresh-superseded", "active", "superseded", "2026-09-20T00:00:00.000Z"),
      finding("fresh-archived-status", "active", "archived", "2026-09-21T00:00:00.000Z"),
      finding("older-open", "active", "open", "2026-08-01T00:00:00.000Z"),
      finding("draft", "active", "draft", "2026-08-15T00:00:00.000Z"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "draft",
      "older-open",
      "fresh-archived-status",
      "fresh-superseded",
    ]);
    expect(isFeaturedFindingEligible(ordered[0])).toBe(true);
    expect(ordered[0].id).toBe("draft");
  });

  test("retired Findings remain in the ordered history when nothing is eligible", () => {
    const ordered = orderFindings([
      finding("a", "active", "superseded", "2026-09-01T00:00:00.000Z"),
      finding("b", "archived", "archived", "2026-09-10T00:00:00.000Z"),
    ]);
    expect(ordered.every((item) => !isFeaturedFindingEligible(item))).toBe(true);
    expect(ordered.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
