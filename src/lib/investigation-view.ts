import type { CustodianFinding, FindingStatus } from "./custodian-types";

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

const RETIRED_FINDING_STATUSES: ReadonlySet<FindingStatus> = new Set(["superseded", "archived"]);

/**
 * A Finding may be featured as the current reading only when it is still live
 * in lifecycle and not retired by status. Superseded/archived status must not
 * displace a valid current Finding even if lifecycleStatus remains "active".
 */
export function isFeaturedFindingEligible(finding: CustodianFinding): boolean {
  return finding.lifecycleStatus === "active" && !RETIRED_FINDING_STATUSES.has(finding.status);
}

/**
 * Eligible Findings first (newest first), then the rest newest first. The
 * first eligible entry is the featured current reading; retired Findings stay
 * in the ordered list as history.
 */
export function orderFindings(findings: readonly CustodianFinding[]): CustodianFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(isFeaturedFindingEligible(b)) - Number(isFeaturedFindingEligible(a)) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}
