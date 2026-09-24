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

function nonBlankTextList(maxItems: number, maxItemLength: number) {
  return z.array(nonBlankText(maxItemLength)).max(maxItems);
}

const REFINE_FINDING_SUPPORT = "finding_requires_supporting_evidence";
const REFINE_UNRESOLVED = "unresolved_requires_uncertainty_or_evidence_gap";
const REFINE_UNIQUE = "evidence_ids_must_be_unique";
const REFINE_OVERLAP = "evidence_ids_must_not_overlap";

function evidenceIdList() {
  return z
    .array(z.string().uuid().describe("UUID of an admitted evidence item from the current Case."))
    .max(32);
}

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function evidenceIdsDoNotOverlap(finding: {
  supporting_evidence_ids: string[];
  contrary_evidence_ids: string[];
}): boolean {
  const contrary = new Set(finding.contrary_evidence_ids);
  return finding.supporting_evidence_ids.every((id) => !contrary.has(id));
}

export const CustodianFindingSchema = z
  .strictObject({
    outcome: z.enum(FINDING_OUTCOMES),
    title: nonBlankText(500),
    conclusion: nonBlankText(30_000),
    analysis_mode: z.enum(FINDING_ANALYSIS_MODES),
    confidence: z.int().min(0).max(100),
    supporting_evidence_ids: evidenceIdList(),
    contrary_evidence_ids: evidenceIdList(),
    uncertainties: nonBlankTextList(32, 1_000),
    assumptions: nonBlankTextList(32, 1_000),
    scope_limits: nonBlankTextList(32, 1_000),
    evidence_gaps: nonBlankTextList(32, 1_000),
    what_would_change_mind: boundedText(10_000),
    revisit_condition: boundedText(10_000),
  })
  .refine(
    (finding) => finding.outcome !== "finding" || finding.supporting_evidence_ids.length > 0,
    { message: REFINE_FINDING_SUPPORT },
  )
  .refine(
    (finding) =>
      finding.outcome !== "unresolved" ||
      finding.uncertainties.length > 0 ||
      finding.evidence_gaps.length > 0,
    { message: REFINE_UNRESOLVED },
  )
  .refine(
    (finding) =>
      uniqueStrings(finding.supporting_evidence_ids) &&
      uniqueStrings(finding.contrary_evidence_ids),
    { message: REFINE_UNIQUE },
  )
  .refine(evidenceIdsDoNotOverlap, { message: REFINE_OVERLAP });

export const CustodianSynthesisSchema = z.strictObject({
  summary: boundedText(10_000),
  findings: z.array(CustodianFindingSchema).max(64),
  requiresApproval: z.boolean(),
  approvalKind: z.enum(APPROVAL_KINDS),
});

export type CustodianSynthesis = z.infer<typeof CustodianSynthesisSchema>;

export const SYNTHESIS_FORMAT_NAME = "custodian_synthesis";

/**
 * Above this many admitted evidence ids the provider schema stops enumerating
 * them and falls back to any UUID: Structured Outputs bounds total enum values
 * and their combined length, and each id is repeated across outcome variants.
 * Local snapshot validation still rejects any id outside the admitted set.
 */
export const MAX_ENUMERATED_EVIDENCE_IDS = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The admitted evidence ids a synthesis may cite, read from the persisted snapshot. */
export function citableEvidenceIdsFromSnapshot(snapshot: Record<string, unknown>): string[] {
  const raw = snapshot.citable_evidence_ids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))];
}

function providerEvidenceIds(citable: readonly string[], required: boolean) {
  // Nothing admitted: no id is legitimate, so the array itself must be empty.
  if (citable.length === 0) return emptyEvidenceIds();
  const item =
    citable.length <= MAX_ENUMERATED_EVIDENCE_IDS
      ? z.enum(citable as [string, ...string[]])
      : z.string().uuid();
  const list = z.array(item).max(32);
  return required ? list.min(1) : list;
}

function emptyEvidenceIds() {
  return z.array(z.string()).max(0);
}

/**
 * Provider-facing finding variants, one per outcome, so Structured Outputs
 * sees each outcome's evidence requirement directly. This is deliberately
 * stricter than the local contract where JSON Schema can express it, and it
 * never replaces local validation: uniqueness, overlap, nonblank text and
 * string bounds are not representable and are still checked after the response.
 */
function providerFindingVariant(
  outcome: (typeof FINDING_OUTCOMES)[number],
  evidence: {
    supporting: ReturnType<typeof providerEvidenceIds> | ReturnType<typeof emptyEvidenceIds>;
    contrary: ReturnType<typeof providerEvidenceIds> | ReturnType<typeof emptyEvidenceIds>;
  },
  uncertaintiesRequired: boolean,
) {
  const uncertainties = nonBlankTextList(32, 1_000);
  return z.strictObject({
    outcome: z.enum([outcome]),
    title: nonBlankText(500),
    conclusion: nonBlankText(30_000),
    analysis_mode: z.enum(FINDING_ANALYSIS_MODES),
    confidence: z.int().min(0).max(100),
    supporting_evidence_ids: evidence.supporting,
    contrary_evidence_ids: evidence.contrary,
    uncertainties: uncertaintiesRequired ? uncertainties.min(1) : uncertainties,
    assumptions: nonBlankTextList(32, 1_000),
    scope_limits: nonBlankTextList(32, 1_000),
    evidence_gaps: nonBlankTextList(32, 1_000),
    what_would_change_mind: boundedText(10_000),
    revisit_condition: boundedText(10_000),
  });
}

export function providerSynthesisSchema(citableEvidenceIds: readonly string[]) {
  const variants = [
    providerFindingVariant(
      "unresolved",
      {
        supporting: providerEvidenceIds(citableEvidenceIds, false),
        contrary: providerEvidenceIds(citableEvidenceIds, false),
      },
      true,
    ),
    providerFindingVariant(
      "no_finding",
      { supporting: emptyEvidenceIds(), contrary: providerEvidenceIds(citableEvidenceIds, false) },
      false,
    ),
    providerFindingVariant(
      "refusal",
      { supporting: emptyEvidenceIds(), contrary: emptyEvidenceIds() },
      false,
    ),
  ];
  // A Finding needs at least one supporting id from the admitted set. With no
  // admitted evidence it cannot be produced at all, so the variant is omitted.
  if (citableEvidenceIds.length > 0) {
    variants.unshift(
      providerFindingVariant(
        "finding",
        {
          supporting: providerEvidenceIds(citableEvidenceIds, true),
          contrary: providerEvidenceIds(citableEvidenceIds, false),
        },
        false,
      ),
    );
  }
  return z.strictObject({
    summary: boundedText(10_000),
    findings: z.array(z.union(variants as [(typeof variants)[number], ...typeof variants])).max(64),
    requiresApproval: z.boolean(),
    approvalKind: z.enum(APPROVAL_KINDS),
  });
}

/** Snapshot-aware Structured Outputs format for one provider attempt. */
export function synthesisTextFormat(citableEvidenceIds: readonly string[]) {
  return zodTextFormat(providerSynthesisSchema(citableEvidenceIds), SYNTHESIS_FORMAT_NAME);
}

export type SynthesisRejectionReason =
  | "malformed_response_shape"
  | "invalid_synthesis_schema"
  | "text_bounds_violation"
  | "finding_missing_support"
  | "unresolved_missing_uncertainty"
  | "evidence_ids_duplicate"
  | "evidence_ids_overlap"
  | "evidence_id_outside_snapshot";

const REFINE_REASONS: Record<string, SynthesisRejectionReason> = {
  [REFINE_FINDING_SUPPORT]: "finding_missing_support",
  [REFINE_UNRESOLVED]: "unresolved_missing_uncertainty",
  [REFINE_UNIQUE]: "evidence_ids_duplicate",
  [REFINE_OVERLAP]: "evidence_ids_overlap",
};

/**
 * Local, bounded reason a returned synthesis was rejected, or null when it is
 * acceptable. The result is one allowlisted token derived only from the shape
 * of the failure; no provider value, text, path or id is ever read into it.
 */
export function classifySynthesisRejection(
  value: unknown,
  snapshot: Record<string, unknown>,
): SynthesisRejectionReason | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "malformed_response_shape";
  }
  const parsed = CustodianSynthesisSchema.safeParse(value);
  if (!parsed.success) {
    let reason: SynthesisRejectionReason = "invalid_synthesis_schema";
    for (const issue of parsed.error.issues) {
      const named = issue.code === "custom" ? REFINE_REASONS[issue.message] : undefined;
      if (named) return named;
      if (issue.code === "custom") reason = "text_bounds_violation";
    }
    return reason;
  }
  return synthesisEvidenceIdsWithinSnapshot(value, snapshot)
    ? null
    : "evidence_id_outside_snapshot";
}

export function validFindingCandidate(value: unknown): boolean {
  return CustodianFindingSchema.safeParse(value).success;
}

export function synthesisEvidenceIdsWithinSnapshot(
  value: unknown,
  snapshot: Record<string, unknown>,
): boolean {
  const parsed = CustodianSynthesisSchema.safeParse(value);
  if (!parsed.success) return false;
  const rawAllowed = snapshot.citable_evidence_ids;
  const allowed = new Set(
    Array.isArray(rawAllowed)
      ? rawAllowed.filter((id): id is string => typeof id === "string")
      : [],
  );
  return parsed.data.findings.every(
    (finding) =>
      finding.supporting_evidence_ids.every((id) => allowed.has(id)) &&
      finding.contrary_evidence_ids.every((id) => allowed.has(id)),
  );
}

export function parseSynthesis(value: unknown): CustodianSynthesis | null {
  const parsed = CustodianSynthesisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validSynthesis(value: unknown): value is CustodianSynthesis {
  return parseSynthesis(value) !== null;
}
