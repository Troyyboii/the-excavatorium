import type { CustodianFinding } from "./custodian-types";

export type TrailStep = {
  key: "question" | "evidence" | "examined" | "judgment";
  label: string;
  detail: string;
  done: boolean;
};

/**
 * The Investigation trail: Question → Evidence → Examined → Your judgment,
 * read only from what is persisted. Owner Judgment on a Finding has no
 * recording path yet, so that step is never shown as done.
 */
export function investigationTrail(input: {
  currentQuestion: string;
  evidenceCount: number;
  findingCount: number;
}): TrailStep[] {
  const framed = input.currentQuestion.trim() !== "";
  const examined = input.findingCount > 0;
  return [
    {
      key: "question",
      label: "Question",
      detail: framed ? "Framed" : "Not framed yet",
      done: framed,
    },
    {
      key: "evidence",
      label: "Evidence",
      detail: `${input.evidenceCount} ${input.evidenceCount === 1 ? "record" : "records"}`,
      done: input.evidenceCount > 0,
    },
    {
      key: "examined",
      label: "Examined",
      detail: examined ? "By the Custodian" : "Not yet",
      done: examined,
    },
    {
      key: "judgment",
      label: "Your judgment",
      detail: examined ? "Waiting on you" : "After examination",
      done: false,
    },
  ];
}

/** Active Findings first, then newest; the first one is featured. */
export function orderFindings(findings: readonly CustodianFinding[]): CustodianFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(b.lifecycleStatus === "active") - Number(a.lifecycleStatus === "active") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}
