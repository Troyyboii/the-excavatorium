import { MIN_COVERAGE_UNITS, preflightSnapshot } from "./preflight.ts";

function assertEquals(actual: unknown, expected: unknown, label = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const RECORD = "c1000000-0000-4000-8000-0000000000c1";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    kind: "readonly_analysis_snapshot",
    contract_version: 2,
    admitted_records: [{ record_id: RECORD, source_units: [] }],
    excluded_records: [],
    citable_evidence_ids: [],
    citable_source_refs: ["r1.f1", "r1.f2", "r1.o1"],
    evidence_budget: {
      units_total: 3,
      units_admitted: 3,
      units_omitted: 0,
      substantive_units_admitted: 3,
    },
    truncated: false,
    ...overrides,
  };
}

function code(value: unknown): string {
  const result = preflightSnapshot(value);
  return result.ok ? "ok" : result.code;
}

Deno.test("a source-backed snapshot passes with no warnings", () => {
  const result = preflightSnapshot(snapshot());
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.substantiveUnitsAdmitted, 3);
    assertEquals(result.warnings, []);
  }
});

Deno.test("an empty selected scope is stopped before any spend", () => {
  assertEquals(code(snapshot({ admitted_records: [], excluded_records: [] })), "empty_scope");
});

Deno.test("an unavailable selected record is reported as unavailable, not as thin content", () => {
  assertEquals(
    code(
      snapshot({
        admitted_records: [],
        excluded_records: [{ record_id: RECORD, reason: "unavailable" }],
      }),
    ),
    "selected_records_unavailable",
  );
});

Deno.test("records dropped for the reading limit are a budget problem, not missing records", () => {
  assertEquals(
    code(
      snapshot({
        admitted_records: [],
        excluded_records: [{ record_id: RECORD, reason: "reading_limit" }],
      }),
    ),
    "context_budget_insufficient",
  );
});

Deno.test("records with nothing beyond a title are stopped as lacking substance", () => {
  assertEquals(
    code(
      snapshot({
        citable_source_refs: [],
        evidence_budget: {
          units_total: 0,
          units_admitted: 0,
          units_omitted: 0,
          substantive_units_admitted: 0,
        },
      }),
    ),
    "no_substantive_content",
  );
});

Deno.test("a short summary alone is not substantive content", () => {
  assertEquals(
    code(
      snapshot({
        citable_source_refs: ["r1.s"],
        evidence_budget: {
          units_total: 1,
          units_admitted: 1,
          units_omitted: 0,
          substantive_units_admitted: 0,
        },
      }),
    ),
    "no_substantive_content",
  );
});

Deno.test("material that exists but did not fit the budget is a budget stop", () => {
  assertEquals(
    code(
      snapshot({
        citable_source_refs: [],
        evidence_budget: {
          units_total: 9,
          units_admitted: 0,
          units_omitted: 9,
          substantive_units_admitted: 0,
        },
      }),
    ),
    "context_budget_insufficient",
  );
});

Deno.test("excessive truncation that leaves almost nothing is stopped", () => {
  assertEquals(
    code(
      snapshot({
        citable_source_refs: ["r1.f1"],
        evidence_budget: {
          units_total: 12,
          units_admitted: 1,
          units_omitted: 11,
          substantive_units_admitted: MIN_COVERAGE_UNITS - 1,
        },
      }),
    ),
    "insufficient_source_coverage",
  );
});

Deno.test("substantive units with nothing citable are a citation policy conflict", () => {
  assertEquals(code(snapshot({ citable_source_refs: [] })), "no_substantive_content");
});

Deno.test("truncation and exclusions are warnings when enough material was admitted", () => {
  const result = preflightSnapshot(
    snapshot({
      truncated: true,
      excluded_records: [{ record_id: "x", reason: "unavailable" }],
    }),
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.warnings, ["snapshot_truncated", "records_excluded"]);
});

Deno.test(
  "a legacy snapshot is stopped when it cannot cite anything, and allowed when it can",
  () => {
    const legacy = {
      kind: "readonly_analysis_snapshot",
      admitted_records: [{ record_id: RECORD, title: "t", summary: "s" }],
      excluded_records: [],
      citable_evidence_ids: [],
      truncated: false,
    };
    assertEquals(code(legacy), "snapshot_contract_outdated");
    assertEquals(
      code({ ...legacy, citable_evidence_ids: ["123e4567-e89b-12d3-a456-426614174111"] }),
      "ok",
    );
  },
);

Deno.test("unreadable snapshots are rejected", () => {
  for (const value of [
    null,
    "x",
    [],
    {},
    { kind: "other" },
    { kind: "readonly_analysis_snapshot" },
  ]) {
    assertEquals(code(value), "snapshot_unreadable");
  }
});

Deno.test("the result never carries archive text", () => {
  const result = preflightSnapshot(
    snapshot({
      admitted_records: [{ record_id: RECORD, title: "SECRET TITLE", summary: "SECRET BODY" }],
      citable_source_refs: [],
    }),
  );
  const text = JSON.stringify(result);
  assertEquals(text.includes("SECRET"), false);
});
