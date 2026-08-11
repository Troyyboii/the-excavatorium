import { describe, expect, test } from "bun:test";
import {
  CustodianFoundationMissingError,
  classifyCustodianError,
  isClaimStatus,
  isCustodianFoundationMissing,
  mapClaimRow,
  mapCustodianCaseRow,
  pageRange,
  paginateOwnerRows,
  upsertCustodianClaim,
  validateConfidence,
} from "./custodian";

const timestamps = {
  created_at: "2026-08-11T19:00:00.000Z",
  updated_at: "2026-08-11T19:01:00.000Z",
};

function caseRow() {
  return {
    id: "case-1",
    owner_id: "owner-1",
    title: "Release 1",
    objective: "Build the foundation",
    current_question: "What is verified?",
    default_working_set: ["claim-1"],
    status: "open",
    closed_at: null,
    created_by: "owner-1",
    updated_by: "owner-1",
    ...timestamps,
  };
}

function claimRow(status = "observed") {
  return {
    id: "claim-1",
    owner_id: "owner-1",
    case_id: "case-1",
    statement: "The migration exists",
    status,
    confidence: 80,
    what_would_change_mind: "A missing file",
    revisit_condition: "After deployment",
    source_record_id: null,
    lifecycle_status: "active",
    created_by: "owner-1",
    updated_by: "owner-1",
    ...timestamps,
  };
}

describe("Custodian mappers and guards", () => {
  test("maps snake_case database rows to owner-free domain objects", () => {
    expect(mapCustodianCaseRow(caseRow())).toEqual({
      id: "case-1",
      title: "Release 1",
      objective: "Build the foundation",
      currentQuestion: "What is verified?",
      defaultWorkingSet: ["claim-1"],
      status: "open",
      closedAt: null,
      createdBy: "owner-1",
      updatedBy: "owner-1",
      createdAt: "2026-08-11T19:00:00.000Z",
      updatedAt: "2026-08-11T19:01:00.000Z",
    });
    expect(mapClaimRow(claimRow("disputed")).status).toBe("disputed");
  });

  test("accepts only the six claim statuses from the plan", () => {
    expect(isClaimStatus("observed")).toBe(true);
    expect(isClaimStatus("reported")).toBe(true);
    expect(isClaimStatus("inferred")).toBe(true);
    expect(isClaimStatus("disputed")).toBe(true);
    expect(isClaimStatus("falsified")).toBe(true);
    expect(isClaimStatus("unresolved")).toBe(true);
    expect(isClaimStatus("confirmed")).toBe(false);
  });

  test("rejects malformed rows and invalid confidence", () => {
    expect(() => mapClaimRow({ ...claimRow(), status: "confirmed" })).toThrow();
    expect(() => mapCustodianCaseRow({ ...caseRow(), updated_at: "not-a-date" })).toThrow();
    expect(() => validateConfidence(101)).toThrow();
    expect(() => validateConfidence(80.5)).toThrow();
  });
});

describe("Custodian foundation and pagination", () => {
  test("classifies missing foundation errors without treating validation as missing", () => {
    const missing = { code: "PGRST205", message: "Could not find the table in the schema cache" };
    expect(isCustodianFoundationMissing(missing)).toBe(true);
    expect(classifyCustodianError(missing)).toBe("missing_foundation");
    expect(classifyCustodianError({ code: "22023", message: "invalid status" })).toBe("validation");
    expect(isCustodianFoundationMissing(new CustodianFoundationMissingError())).toBe(true);
  });

  test("uses deterministic inclusive ranges and stops at the short page", async () => {
    expect(pageRange(0, 2)).toEqual({ from: 0, to: 1 });
    expect(pageRange(2, 2)).toEqual({ from: 4, to: 5 });
    const requested: Array<{ from: number; to: number }> = [];
    const rows = await paginateOwnerRows(
      async (range) => {
        requested.push(range);
        return range.from === 0 ? ["a", "b"] : ["c"];
      },
      { pageSize: 2 },
    );
    expect(rows).toEqual(["a", "b", "c"]);
    expect(requested).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
  });
});

describe("Custodian RPC input validation", () => {
  test("rejects invalid claim input before any RPC call", () => {
    expect(() =>
      upsertCustodianClaim({
        caseId: "case-1",
        statement: "A claim",
        confidence: 101,
      }),
    ).toThrow("confidence");
  });
});
