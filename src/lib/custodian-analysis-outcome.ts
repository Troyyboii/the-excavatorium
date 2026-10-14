/**
 * Plain-language classification of what an analysis run or Finding actually
 * delivered. A run that reaches `completed` only means the provider answered
 * and the answer passed validation; it does not say the answer was grounded.
 * These helpers keep the distinctions the lifecycle cannot carry:
 *
 *   supported            a Finding resting on cited material
 *   meaningful_uncertainty  unresolved, but the admitted material was cited
 *   insufficient_source  no source material was cited (or never supplied)
 *
 * and, for runs that stopped, why: not enough source material, a budget or
 * policy stop, a provider failure, or a retrieval/admission failure.
 */
import type { CustodianFinding, CustodianFindingEvidence } from "./custodian-types";

export type FindingOutcomeClass = "supported" | "meaningful_uncertainty" | "insufficient_source";

export type FindingOutcomeView = {
  kind: FindingOutcomeClass;
  label: string;
  /** False when a number would imply confidence in material that was never cited. */
  showNumericConfidence: boolean;
};

export function classifyFindingOutcome(
  finding: Pick<CustodianFinding, "originKind" | "analysisOutcome" | "sourceCitations">,
  evidenceLinks: readonly Pick<CustodianFindingEvidence, "relationshipKind">[] = [],
): FindingOutcomeView | null {
  if (finding.originKind !== "analysis") return null;
  const supportingCitations = finding.sourceCitations.filter(
    (citation) => citation.relationship === "supporting",
  ).length;
  const supportingEvidence = evidenceLinks.filter(
    (link) => link.relationshipKind === "supporting",
  ).length;
  const cited = supportingCitations + supportingEvidence > 0 || finding.sourceCitations.length > 0;
  if (!cited) {
    return {
      kind: "insufficient_source",
      label: "Insufficient source material — nothing was cited",
      showNumericConfidence: false,
    };
  }
  if (finding.analysisOutcome === "unresolved") {
    return {
      kind: "meaningful_uncertainty",
      label: "Unresolved, with the admitted material cited",
      showNumericConfidence: true,
    };
  }
  return {
    kind: "supported",
    label: "Supported by cited archive material",
    showNumericConfidence: true,
  };
}

export type RunStopClass =
  | "insufficient_source"
  | "budget_or_policy"
  | "provider_failure"
  | "admission_failure";

export type RunStopView = { kind: RunStopClass; label: string };

const PREFLIGHT_LABELS: Record<string, string> = {
  empty_scope: "No archive records are selected.",
  selected_records_unavailable: "The selected archive records could not be read.",
  context_budget_insufficient: "The selected records did not fit the run's context budget.",
  no_substantive_content: "The selected records hold nothing beyond a title or short summary.",
  insufficient_source_coverage: "Too little of the selected material fit to analyse it fairly.",
  snapshot_contract_outdated: "This run predates archive claims; start a new analysis.",
  snapshot_unreadable: "The stored analysis input could not be read.",
};

/** Maps a persisted run failure code to a user-facing class. Null for codes this does not own. */
export function classifyRunStop(failureCode: string | null | undefined): RunStopView | null {
  if (!failureCode) return null;
  if (failureCode.startsWith("preflight_")) {
    const detail = PREFLIGHT_LABELS[failureCode.slice("preflight_".length)];
    const budget =
      failureCode === "preflight_context_budget_insufficient" ||
      failureCode === "preflight_insufficient_source_coverage";
    return {
      kind:
        failureCode === "preflight_snapshot_unreadable" ||
        failureCode === "preflight_selected_records_unavailable" ||
        failureCode === "preflight_empty_scope"
          ? "admission_failure"
          : "insufficient_source",
      label:
        `Insufficient source material${budget ? " (context budget)" : ""}. ${detail ?? ""} No provider call was made.`.trim(),
    };
  }
  if (failureCode.startsWith("openai_") || failureCode.startsWith("provider_")) {
    return { kind: "provider_failure", label: "The provider did not return a usable answer." };
  }
  if (/^(per_run|daily|monthly)_/.test(failureCode) || failureCode.includes("budget")) {
    return { kind: "budget_or_policy", label: "Stopped by a budget or policy limit." };
  }
  return null;
}
