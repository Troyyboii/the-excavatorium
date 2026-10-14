/**
 * Provider-free admission preflight for a persisted readonly analysis snapshot.
 *
 * It runs before any reservation, so a request that can only produce a
 * non-answer never holds or spends the owner's budget. It reads only counts and
 * enumerated reasons from the snapshot; it never copies archive text.
 *
 * "Unresolved because the evidence is genuinely inconclusive" is a valid
 * analysis result and is not decided here. This only stops runs where the
 * evidence was never supplied to the model.
 */

export const PREFLIGHT_CODES = [
  "snapshot_unreadable",
  "snapshot_contract_outdated",
  "empty_scope",
  "selected_records_unavailable",
  "context_budget_insufficient",
  "no_substantive_content",
  "insufficient_source_coverage",
] as const;
export type PreflightCode = (typeof PREFLIGHT_CODES)[number];

export const PREFLIGHT_FAILURE_PREFIX = "preflight_";

/** Smallest number of substantive units a run may proceed on when more were available. */
export const MIN_COVERAGE_UNITS = 2;

export type PreflightResult =
  | {
      ok: true;
      sourceUnitsAdmitted: number;
      substantiveUnitsAdmitted: number;
      warnings: string[];
    }
  | { ok: false; code: PreflightCode; failureCode: string; message: string };

const MESSAGES: Record<PreflightCode, string> = {
  snapshot_unreadable:
    "The stored analysis input could not be read, so no provider call was made. Start the analysis again.",
  snapshot_contract_outdated:
    "This run was prepared before archive claims could be supplied and has nothing citable. No provider call was made. Start a new analysis to use the current evidence format.",
  empty_scope:
    "No archive records are selected for this Investigation. No provider call was made. Select records in the archive scope and start again.",
  selected_records_unavailable:
    "None of the selected archive records could be read. No provider call was made. Check that the records still exist, then start again.",
  context_budget_insufficient:
    "The selected records do not fit this run's context budget, so no source material was supplied. No provider call was made. Select fewer records or raise the per-run token ceiling.",
  no_substantive_content:
    "The selected records contain nothing beyond a title or a short summary, so there is no material to analyse. No provider call was made. Add claims, findings or notes to the records, or select richer records.",
  insufficient_source_coverage:
    "Too little of the selected material fit this run's context budget to analyse it fairly. No provider call was made. Select fewer records or raise the per-run token ceiling.",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function fail(code: PreflightCode): PreflightResult {
  return {
    ok: false,
    code,
    failureCode: `${PREFLIGHT_FAILURE_PREFIX}${code}`,
    message: MESSAGES[code],
  };
}

export function preflightSnapshot(snapshot: unknown): PreflightResult {
  if (
    !isObject(snapshot) ||
    snapshot.kind !== "readonly_analysis_snapshot" ||
    !Array.isArray(snapshot.admitted_records) ||
    !Array.isArray(snapshot.excluded_records)
  ) {
    return fail("snapshot_unreadable");
  }
  const admitted = snapshot.admitted_records;
  const excluded = snapshot.excluded_records;
  const citableEvidenceIds = Array.isArray(snapshot.citable_evidence_ids)
    ? snapshot.citable_evidence_ids.length
    : 0;
  const citableSourceRefs = Array.isArray(snapshot.citable_source_refs)
    ? snapshot.citable_source_refs.length
    : 0;

  if (admitted.length === 0) {
    if (excluded.length === 0) return fail("empty_scope");
    const allUnavailable = excluded.every(
      (entry) => isObject(entry) && entry.reason === "unavailable",
    );
    return fail(allUnavailable ? "selected_records_unavailable" : "context_budget_insufficient");
  }

  if (snapshot.contract_version !== 2) {
    // Snapshots from before source units still work when they can cite case evidence.
    return citableEvidenceIds > 0
      ? { ok: true, sourceUnitsAdmitted: 0, substantiveUnitsAdmitted: 0, warnings: [] }
      : fail("snapshot_contract_outdated");
  }

  const budget = isObject(snapshot.evidence_budget) ? snapshot.evidence_budget : {};
  const unitsTotal = count(budget.units_total);
  const unitsAdmitted = count(budget.units_admitted);
  const substantive = count(budget.substantive_units_admitted);
  const unitsOmitted = count(budget.units_omitted);

  if (unitsAdmitted === 0) {
    return fail(unitsTotal > 0 ? "context_budget_insufficient" : "no_substantive_content");
  }
  if (substantive === 0) {
    return fail(unitsOmitted > 0 ? "context_budget_insufficient" : "no_substantive_content");
  }
  if (citableSourceRefs === 0 && citableEvidenceIds === 0) {
    // Material exists but nothing can be cited: the policy and snapshot disagree.
    return fail("no_substantive_content");
  }
  if (substantive < MIN_COVERAGE_UNITS && unitsOmitted > 0) {
    return fail("insufficient_source_coverage");
  }

  const warnings: string[] = [];
  if (snapshot.truncated === true) warnings.push("snapshot_truncated");
  if (excluded.length > 0) warnings.push("records_excluded");
  return {
    ok: true,
    sourceUnitsAdmitted: unitsAdmitted,
    substantiveUnitsAdmitted: substantive,
    warnings,
  };
}
