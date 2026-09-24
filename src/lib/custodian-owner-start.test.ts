// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { describe, expect, test } from "bun:test";
import {
  assessOwnerAnalysisReadiness,
  buildOwnerReadonlyAnalysisInput,
  OWNER_READONLY_CEILINGS,
  OWNER_READONLY_POLICY_NAME,
  OWNER_READONLY_PROMPT_VERSION,
  ownerAnalysisObjective,
} from "./custodian-owner-start";
import { parseReadonlyAnalysisDraft, emptyReadonlyAnalysisDraft } from "./custodian-readonly-run";

const CASE_ID = "00000000-0000-4000-8000-000000000002";

describe("owner Investigation analysis start", () => {
  test("blocks clearly when the provider key or model preference is missing", () => {
    expect(
      assessOwnerAnalysisReadiness({
        caseId: CASE_ID,
        objective: "What does the archive support?",
        providerKeyStatus: { configured: false },
        modelPreference: "gpt-5.6-terra",
      }).reason,
    ).toBe("provider_key_missing");

    expect(
      assessOwnerAnalysisReadiness({
        caseId: CASE_ID,
        objective: "What does the archive support?",
        providerKeyStatus: { configured: true, last4: "abcd", keyVersion: 1, updatedAt: null },
        modelPreference: null,
      }).reason,
    ).toBe("model_not_selected");

    expect(
      assessOwnerAnalysisReadiness({
        caseId: CASE_ID,
        objective: "What does the archive support?",
        providerKeyStatus: { configured: true, last4: "abcd", keyVersion: 1, updatedAt: null },
        modelPreference: "gpt-unknown",
      }).reason,
    ).toBe("model_selection_invalid");
  });

  test("derives model_tier from Settings preference without requiring typed ceilings", () => {
    const ready = assessOwnerAnalysisReadiness({
      caseId: CASE_ID,
      objective: "What does the archive support?",
      providerKeyStatus: { configured: true, last4: "abcd", keyVersion: 1, updatedAt: null },
      modelPreference: "gpt-5.6-luna",
    });
    expect(ready.ok).toBe(true);
    if (!ready.ok) throw new Error("expected ready");
    expect(ready.modelTier).toBe("luna");

    const input = buildOwnerReadonlyAnalysisInput({
      caseId: CASE_ID,
      objective: "What does the archive support?",
      modelTier: ready.modelTier,
    });
    expect(input.policyName).toBe(OWNER_READONLY_POLICY_NAME);
    expect(input.promptVersion).toBe(OWNER_READONLY_PROMPT_VERSION);
    expect(input.modelTier).toBe("luna");
    expect(input.caseId).toBe(CASE_ID);
    expect(input.perRunTokenBudget).toBe(OWNER_READONLY_CEILINGS.perRunTokenBudget);
    expect(input.perRunCostUsd).toBe(OWNER_READONLY_CEILINGS.perRunCostUsd);
    expect(input.allowedModelTiers).toContain("luna");
    expect(input.allowedModelTiers.length).toBe(4);

    // The built input must satisfy the same closed parser as Advanced / Run Room.
    const asDraft = emptyReadonlyAnalysisDraft({
      caseId: input.caseId,
      policyName: input.policyName,
      allowedModelTiers: [...input.allowedModelTiers],
      perRunTokenBudget: String(input.perRunTokenBudget),
      perRunCostUsd: String(input.perRunCostUsd),
      perRunLatencyMs: String(input.perRunLatencyMs),
      perRunToolEventBudget: String(input.perRunToolEventBudget),
      dailyTokenBudget: String(input.dailyTokenBudget),
      monthlyTokenBudget: String(input.monthlyTokenBudget),
      dailyCostUsd: String(input.dailyCostUsd),
      monthlyCostUsd: String(input.monthlyCostUsd),
      modelTier: input.modelTier,
      promptVersion: input.promptVersion,
      objective: input.objective,
    });
    const parsed = parseReadonlyAnalysisDraft(asDraft);
    expect(parsed.ok).toBe(true);
  });

  test("uses the current question when the objective is blank", () => {
    expect(ownerAnalysisObjective("", "Does the evidence still hold?")).toBe(
      "Does the evidence still hold?",
    );
    expect(ownerAnalysisObjective("Primary objective", "Question")).toBe("Primary objective");
  });
});
