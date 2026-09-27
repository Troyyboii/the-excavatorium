import { describe, expect, test } from "bun:test";
import type { CustodianFinding } from "./custodian-types";
import { investigationTrail, orderFindings } from "./investigation-view";

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
  const finding = (id: string, lifecycleStatus: string, updatedAt: string) =>
    ({ id, lifecycleStatus, updatedAt }) as unknown as CustodianFinding;

  test("puts active Findings first, newest first", () => {
    expect(
      orderFindings([
        finding("old-active", "active", "2026-08-01T00:00:00.000Z"),
        finding("new-superseded", "superseded", "2026-09-01T00:00:00.000Z"),
        finding("new-active", "active", "2026-08-20T00:00:00.000Z"),
      ]).map((item) => item.id),
    ).toEqual(["new-active", "old-active", "new-superseded"]);
  });
});
