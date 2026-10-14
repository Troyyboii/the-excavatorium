/**
 * The bounded evidence contract shared by the browser Case Reading and the
 * database snapshot builder (custodian_build_readonly_analysis_snapshot).
 *
 * The snapshot is built inside Postgres, under the owner's session and inside
 * one transaction, so it cannot execute this module. This file is the single
 * statement of which archive fields feed analysis; evidence-contract.test.ts
 * fails if the SQL builder or case-reading.ts drifts from it.
 *
 * Not admitted, on purpose: conversation rawConversationText, document storage
 * paths, and any unknown record_data key.
 */
import type { RecordType } from "./types";

export type EvidenceFieldContract = {
  /** record_data key. */
  key: string;
  /** Stable one-letter code used in source refs (r<selection index>.<code><n>). */
  code: string;
};

export const EVIDENCE_FIELD_CONTRACT: Record<RecordType, readonly EvidenceFieldContract[]> = {
  conversation: [
    { key: "highSignalFindings", code: "f" },
    { key: "decisionsMade", code: "d" },
    { key: "openLoops", code: "o" },
    { key: "memoryCandidates", code: "m" },
    { key: "reusablePrompts", code: "p" },
  ],
  document: [
    { key: "highSignalFindings", code: "f" },
    { key: "keyClaims", code: "k" },
    { key: "contradictions", code: "c" },
    { key: "uncertainties", code: "u" },
  ],
  decision: [
    { key: "reason", code: "r" },
    { key: "trigger", code: "t" },
    { key: "whatWouldChangeMyMind", code: "w" },
  ],
  tool: [
    { key: "whatActuallyHappened", code: "h" },
    { key: "whatWorked", code: "w" },
    { key: "whatFailed", code: "x" },
    { key: "whyIKeptOrStoppedUsingIt", code: "y" },
    { key: "finalVerdict", code: "v" },
    { key: "whatItPromised", code: "p" },
    { key: "revisitCondition", code: "r" },
  ],
  repository: [
    { key: "whatItClaims", code: "c" },
    { key: "whatItActuallyDoes", code: "a" },
    { key: "maintenanceImpression", code: "m" },
    { key: "finalVerdict", code: "v" },
  ],
};

/** Keys that must never reach a provider snapshot. */
export const EVIDENCE_NEVER_ADMITTED = [
  "rawConversationText",
  "storagePath",
  "extractedContentPath",
] as const;

/** Per-unit and per-field bounds the SQL builder applies. */
export const EVIDENCE_UNIT_CHAR_LIMIT = 700;
export const EVIDENCE_FIELD_UNIT_CAP = 24;
/** Bytes the evidence budget reserves per admitted ref for the schema enumeration. */
export const EVIDENCE_REF_ENUM_BYTES = 70;
/** Fixed request bytes and output hold the per-run ceiling must cover before evidence. */
export const EVIDENCE_FIXED_REQUEST_BYTES = 10_500;
export const EVIDENCE_OUTPUT_HOLD_TOKENS = 4096;

/** Mirrors the evidence-budget formula in custodian_create_readonly_analysis_run. */
export function evidenceBudgetBytes(perRunTokenBudget: number, objectiveBytes: number): number {
  return Math.max(
    0,
    Math.floor(
      ((perRunTokenBudget -
        EVIDENCE_OUTPUT_HOLD_TOKENS -
        EVIDENCE_FIXED_REQUEST_BYTES -
        objectiveBytes) *
        100) /
        115,
    ),
  );
}
