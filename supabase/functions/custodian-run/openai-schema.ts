import { zodTextFormat } from "npm:openai@7.20.0/helpers/zod";
import { z } from "npm:zod@3.25.76/v4";

/**
 * Canonical Custodian synthesis contract. The same Zod schema produces the
 * Structured Outputs format sent to the provider and validates the returned
 * output before any Finding or approval is materialized.
 *
 * The contract is readonly analysis data. It carries no diff, tool action, or
 * other executable payload: an approval records an owner decision about the
 * synthesis, and approval is not execution.
 */

export const FINDING_OUTCOMES = ["finding", "unresolved", "refusal", "no_finding"] as const;
export const FINDING_ANALYSIS_MODES = [
  "plan",
  "claim_review",
  "evidence_gap",
  "contradiction",
  "timeline",
  "causal",
  "risk",
  "decision",
  "synthesis",
] as const;
export const APPROVAL_KINDS = [
  "tool_action",
  "canonical_write",
  "external_write",
  "archive_change",
] as const;

// String length bounds are checked locally after parsing. They are described to
// the model but not emitted as maxLength, which is not in the documented
// Structured Outputs keyword list. Descriptions, enums, integer ranges, and
// array item limits are documented and are emitted.
function boundedText(maxLength: number) {
  return z
    .string()
    .refine((value) => value.length <= maxLength)
    .describe(`At most ${maxLength} characters.`);
}

function nonBlankText(maxLength: number) {
  return z
    .string()
    .refine((value) => value.trim().length > 0 && value.length <= maxLength)
    .describe(`Nonblank. At most ${maxLength} characters.`);
}

function textList(maxItems: number, maxItemLength: number) {
  return z.array(boundedText(maxItemLength)).max(maxItems);
}

function hasMeaningfulCaveat(finding: {
  uncertainties: string[];
  assumptions: string[];
  scope_limits: string[];
  evidence_gaps: string[];
}): boolean {
  return [
    finding.uncertainties,
    finding.assumptions,
    finding.scope_limits,
    finding.evidence_gaps,
  ].some((items) => items.some((item) => item.trim().length > 0));
}

export const CustodianFindingSchema = z
  .strictObject({
    outcome: z.enum(FINDING_OUTCOMES),
    title: nonBlankText(500),
    conclusion: nonBlankText(30_000),
    analysis_mode: z.enum(FINDING_ANALYSIS_MODES),
    confidence: z.int().min(0).max(100),
    supporting_evidence_ids: textList(32, 100),
    contrary_evidence_ids: textList(32, 100),
    uncertainties: textList(32, 1_000),
    assumptions: textList(32, 1_000),
    scope_limits: textList(32, 1_000),
    evidence_gaps: textList(32, 1_000),
    what_would_change_mind: boundedText(10_000),
    revisit_condition: boundedText(10_000),
  })
  .refine(
    (finding) => finding.outcome !== "finding" || finding.supporting_evidence_ids.length > 0,
    { message: "finding_requires_supporting_evidence" },
  )
  .refine((finding) => finding.outcome !== "unresolved" || hasMeaningfulCaveat(finding), {
    message: "unresolved_requires_caveat",
  });

export const CustodianSynthesisSchema = z.strictObject({
  summary: boundedText(10_000),
  findings: z.array(CustodianFindingSchema).max(64),
  requiresApproval: z.boolean(),
  approvalKind: z.enum(APPROVAL_KINDS),
});

export type CustodianSynthesis = z.infer<typeof CustodianSynthesisSchema>;

export const SYNTHESIS_FORMAT_NAME = "custodian_synthesis";

export function synthesisTextFormat() {
  return zodTextFormat(CustodianSynthesisSchema, SYNTHESIS_FORMAT_NAME);
}

export function validFindingCandidate(value: unknown): boolean {
  return CustodianFindingSchema.safeParse(value).success;
}

export function parseSynthesis(value: unknown): CustodianSynthesis | null {
  const parsed = CustodianSynthesisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validSynthesis(value: unknown): value is CustodianSynthesis {
  return parseSynthesis(value) !== null;
}
