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

/** Bounded, short ref of an admitted source unit, for example "r1.f3". */
const SOURCE_REF_RE = /^r[0-9]{1,3}\.[a-z][0-9]{0,3}$/;

function sourceRefList() {
  return z
    .array(
      z
        .string()
        .refine((value) => SOURCE_REF_RE.test(value))
        .describe("Ref of an admitted source unit in this snapshot, for example r1.f3."),
    )
    .max(32);
}

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function evidenceIdsDoNotOverlap(finding: {
  supporting_evidence_ids: string[];
  contrary_evidence_ids: string[];
  supporting_source_refs: string[];
  contrary_source_refs: string[];
}): boolean {
  const contrary = new Set(finding.contrary_evidence_ids);
  const contraryRefs = new Set(finding.contrary_source_refs);
  return (
    finding.supporting_evidence_ids.every((id) => !contrary.has(id)) &&
    finding.supporting_source_refs.every((ref) => !contraryRefs.has(ref))
  );
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
    // Absent in outputs recorded before source-unit citations existed.
    supporting_source_refs: sourceRefList().default([]),
    contrary_source_refs: sourceRefList().default([]),
    uncertainties: nonBlankTextList(32, 1_000),
    assumptions: nonBlankTextList(32, 1_000),
    scope_limits: nonBlankTextList(32, 1_000),
    evidence_gaps: nonBlankTextList(32, 1_000),
    what_would_change_mind: boundedText(10_000),
    revisit_condition: boundedText(10_000),
  })
  .refine(
    (finding) =>
      finding.outcome !== "finding" ||
      finding.supporting_evidence_ids.length + finding.supporting_source_refs.length > 0,
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
      uniqueStrings(finding.contrary_evidence_ids) &&
      uniqueStrings(finding.supporting_source_refs) &&
      uniqueStrings(finding.contrary_source_refs),
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
/** Refs are short, so more of them can be enumerated; local validation is unchanged. */
export const MAX_ENUMERATED_SOURCE_REFS = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The admitted evidence ids a synthesis may cite, read from the persisted snapshot. */
export function citableEvidenceIdsFromSnapshot(snapshot: Record<string, unknown>): string[] {
  const raw = snapshot.citable_evidence_ids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))];
}

/** The admitted source-unit refs a synthesis may cite, read from the persisted snapshot. */
export function citableSourceRefsFromSnapshot(snapshot: Record<string, unknown>): string[] {
  const raw = snapshot.citable_source_refs;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((ref): ref is string => typeof ref === "string" && SOURCE_REF_RE.test(ref)),
    ),
  ];
}

function providerSourceRefs(citable: readonly string[], required: boolean) {
  if (citable.length === 0) return emptyEvidenceIds();
  const item =
    citable.length <= MAX_ENUMERATED_SOURCE_REFS
      ? z.enum(citable as [string, ...string[]])
      : z.string().refine((value) => SOURCE_REF_RE.test(value));
  const list = z.array(item).max(32);
  return required ? list.min(1) : list;
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
    supportingRefs: ReturnType<typeof providerEvidenceIds> | ReturnType<typeof emptyEvidenceIds>;
    contraryRefs: ReturnType<typeof providerEvidenceIds> | ReturnType<typeof emptyEvidenceIds>;
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
    supporting_source_refs: evidence.supportingRefs,
    contrary_source_refs: evidence.contraryRefs,
    uncertainties: uncertaintiesRequired ? uncertainties.min(1) : uncertainties,
    assumptions: nonBlankTextList(32, 1_000),
    scope_limits: nonBlankTextList(32, 1_000),
    evidence_gaps: nonBlankTextList(32, 1_000),
    what_would_change_mind: boundedText(10_000),
    revisit_condition: boundedText(10_000),
  });
}

export function providerSynthesisSchema(
  citableEvidenceIds: readonly string[],
  citableSourceRefs: readonly string[] = [],
) {
  const noneIds = emptyEvidenceIds();
  const noneRefs = emptyEvidenceIds();
  const variants = [
    providerFindingVariant(
      "unresolved",
      {
        supporting: providerEvidenceIds(citableEvidenceIds, false),
        contrary: providerEvidenceIds(citableEvidenceIds, false),
        supportingRefs: providerSourceRefs(citableSourceRefs, false),
        contraryRefs: providerSourceRefs(citableSourceRefs, false),
      },
      true,
    ),
    providerFindingVariant(
      "no_finding",
      {
        supporting: noneIds,
        contrary: providerEvidenceIds(citableEvidenceIds, false),
        supportingRefs: noneRefs,
        contraryRefs: providerSourceRefs(citableSourceRefs, false),
      },
      false,
    ),
    providerFindingVariant(
      "refusal",
      { supporting: noneIds, contrary: noneIds, supportingRefs: noneRefs, contraryRefs: noneRefs },
      false,
    ),
  ];
  // A Finding needs at least one supporting citation: an admitted evidence id
  // or an admitted source-unit ref. With neither admitted it cannot be produced
  // at all, so the variants are omitted.
  if (citableSourceRefs.length > 0) {
    variants.unshift(
      providerFindingVariant(
        "finding",
        {
          supporting: providerEvidenceIds(citableEvidenceIds, false),
          contrary: providerEvidenceIds(citableEvidenceIds, false),
          supportingRefs: providerSourceRefs(citableSourceRefs, true),
          contraryRefs: providerSourceRefs(citableSourceRefs, false),
        },
        false,
      ),
    );
  }
  if (citableEvidenceIds.length > 0) {
    variants.unshift(
      providerFindingVariant(
        "finding",
        {
          supporting: providerEvidenceIds(citableEvidenceIds, true),
          contrary: providerEvidenceIds(citableEvidenceIds, false),
          supportingRefs: providerSourceRefs(citableSourceRefs, false),
          contraryRefs: providerSourceRefs(citableSourceRefs, false),
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
export function synthesisTextFormat(
  citableEvidenceIds: readonly string[],
  citableSourceRefs: readonly string[] = [],
) {
  return zodTextFormat(
    providerSynthesisSchema(citableEvidenceIds, citableSourceRefs),
    SYNTHESIS_FORMAT_NAME,
  );
}

export type SynthesisRejectionReason =
  | "malformed_response_shape"
  | "invalid_synthesis_schema"
  | "text_bounds_violation"
  | "finding_missing_support"
  | "unresolved_missing_uncertainty"
  | "evidence_ids_duplicate"
  | "evidence_ids_overlap"
  | "evidence_id_outside_snapshot"
  | "source_ref_outside_snapshot";

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
  if (!synthesisEvidenceIdsOnlyWithinSnapshot(value, snapshot))
    return "evidence_id_outside_snapshot";
  if (!synthesisSourceRefsWithinSnapshot(value, snapshot)) return "source_ref_outside_snapshot";
  return null;
}

export function validFindingCandidate(value: unknown): boolean {
  return CustodianFindingSchema.safeParse(value).success;
}

function synthesisEvidenceIdsOnlyWithinSnapshot(
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

function synthesisSourceRefsWithinSnapshot(
  value: unknown,
  snapshot: Record<string, unknown>,
): boolean {
  const parsed = CustodianSynthesisSchema.safeParse(value);
  if (!parsed.success) return false;
  const allowed = new Set(citableSourceRefsFromSnapshot(snapshot));
  return parsed.data.findings.every(
    (finding) =>
      finding.supporting_source_refs.every((ref) => allowed.has(ref)) &&
      finding.contrary_source_refs.every((ref) => allowed.has(ref)),
  );
}

/** Every cited evidence id and source-unit ref must have been admitted to this run's snapshot. */
export function synthesisEvidenceIdsWithinSnapshot(
  value: unknown,
  snapshot: Record<string, unknown>,
): boolean {
  return (
    synthesisEvidenceIdsOnlyWithinSnapshot(value, snapshot) &&
    synthesisSourceRefsWithinSnapshot(value, snapshot)
  );
}

export function parseSynthesis(value: unknown): CustodianSynthesis | null {
  const parsed = CustodianSynthesisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validSynthesis(value: unknown): value is CustodianSynthesis {
  return parseSynthesis(value) !== null;
}
