import { describe, expect, test } from "bun:test";
import { classifyFindingOutcome, classifyRunStop } from "./custodian-analysis-outcome";
import { mapCustodianFindingRow } from "./custodian";

const citation = {
  ref: "r1.f3",
  relationship: "supporting" as const,
  recordId: "c1000000-0000-4000-8000-0000000000c1",
  recordType: "conversation",
  recordTitle: "Trait research notes A",
  selectionIndex: 1,
  field: "High-signal findings",
  unitKind: "finding",
  evidenceLevel: "owner_extracted_notes",
  currency: "unspecified",
  excerpt: "Claim A3",
};

describe("finding outcome classes", () => {
  test("a generic evidence-gap result that cites nothing is insufficient source, with no score", () => {
    const view = classifyFindingOutcome({
      originKind: "analysis",
      analysisOutcome: "unresolved",
      sourceCitations: [],
    });
    expect(view?.kind).toBe("insufficient_source");
    expect(view?.showNumericConfidence).toBe(false);
  });

  test("unresolved with cited material is meaningful uncertainty and keeps its score", () => {
    const view = classifyFindingOutcome({
      originKind: "analysis",
      analysisOutcome: "unresolved",
      sourceCitations: [citation],
    });
    expect(view?.kind).toBe("meaningful_uncertainty");
    expect(view?.showNumericConfidence).toBe(true);
  });

  test("a finding with cited archive material is supported", () => {
    const view = classifyFindingOutcome({
      originKind: "analysis",
      analysisOutcome: "finding",
      sourceCitations: [citation],
    });
    expect(view?.kind).toBe("supported");
  });

  test("legacy evidence-item links still count as cited material", () => {
    const view = classifyFindingOutcome(
      { originKind: "analysis", analysisOutcome: "finding", sourceCitations: [] },
      [{ relationshipKind: "supporting" }],
    );
    expect(view?.kind).toBe("supported");
  });

  test("owner-authored and legacy findings are not classified", () => {
    for (const originKind of ["owner_authored", "legacy"] as const) {
      expect(
        classifyFindingOutcome({ originKind, analysisOutcome: null, sourceCitations: [] }),
      ).toBeNull();
    }
  });
});

describe("run stop classes", () => {
  test("preflight stops say no provider call was made", () => {
    for (const code of [
      "preflight_empty_scope",
      "preflight_no_substantive_content",
      "preflight_context_budget_insufficient",
      "preflight_insufficient_source_coverage",
      "preflight_selected_records_unavailable",
    ]) {
      const view = classifyRunStop(code);
      expect(view).not.toBeNull();
      expect(view?.label).toContain("No provider call was made");
    }
    expect(classifyRunStop("preflight_no_substantive_content")?.kind).toBe("insufficient_source");
    expect(classifyRunStop("preflight_empty_scope")?.kind).toBe("admission_failure");
  });

  test("provider and budget failures keep their own classes", () => {
    expect(classifyRunStop("openai_refusal")?.kind).toBe("provider_failure");
    expect(classifyRunStop("per_run_tokens")?.kind).toBe("budget_or_policy");
    expect(classifyRunStop(null)).toBeNull();
    expect(classifyRunStop("something_else")).toBeNull();
  });
});

describe("Finding row mapping", () => {
  const base = {
    id: "f1",
    owner_id: "o1",
    case_id: "c1",
    analysis_mode: "synthesis",
    title: "t",
    finding: "x",
    confidence: 50,
    what_would_change_mind: "",
    revisit_condition: "",
    source_record_id: null,
    status: "open",
    lifecycle_status: "active",
    origin_kind: "analysis",
    analysis_outcome: "finding",
    origin_run_id: "r1",
    origin_step_id: "s1",
    candidate_index: 0,
    analysis_result_hash: "h",
    uncertainties: [],
    assumptions: [],
    scope_limits: [],
    evidence_gaps: [],
    created_by: "o1",
    updated_by: "o1",
    created_at: "2026-10-14T10:00:00Z",
    updated_at: "2026-10-14T10:00:00Z",
  };

  test("rows read before citations existed stay readable", () => {
    expect(mapCustodianFindingRow(base).sourceCitations).toEqual([]);
  });

  test("source citations map to the typed shape and drop malformed entries", () => {
    const mapped = mapCustodianFindingRow({
      ...base,
      source_citations: [
        {
          ref: "r1.f3",
          relationship: "contrary",
          record_id: "c1",
          record_type: "conversation",
          record_title: "Notes",
          selection_index: 1,
          field: "High-signal findings",
          unit_kind: "finding",
          evidence_level: "owner_extracted_notes",
          currency: "unspecified",
          excerpt: "Claim",
        },
        "garbage",
        { relationship: "supporting" },
      ],
    });
    expect(mapped.sourceCitations).toHaveLength(1);
    expect(mapped.sourceCitations[0].relationship).toBe("contrary");
    expect(mapped.sourceCitations[0].recordTitle).toBe("Notes");
  });

  test("a non-array citation column is rejected", () => {
    expect(() => mapCustodianFindingRow({ ...base, source_citations: "x" })).toThrow();
  });
});
