/**
 * Normal-owner Investigation analysis start.
 *
 * Builds an explicit readonly analysis input without asking the owner to type
 * case_id, policy_name, model_tier, prompt_version, pricing, or reservation
 * ceilings. Technical Advanced / Run Room still accepts those fields.
 *
 * Ceilings remain real owner-visible budgets (not removed). Preference-derived
 * tier still must match the server BYOK preference or the run fails closed.
 */
import { MODEL_ALLOWLIST, type ModelTier } from "./custodian-runtime-types";
import type { ReadonlyAnalysisStartInput } from "./custodian-readonly-run";
import type { OpenAiModelId } from "./openai-models";
import { openAiModelTier } from "./openai-models";
import type { ProviderKeyStatus } from "./provider-key";

const MODEL_TIERS = Object.keys(MODEL_ALLOWLIST) as ModelTier[];

/** Stable policy identity for the product Investigation start path. */
export const OWNER_READONLY_POLICY_NAME = "owner-readonly";

/** Prompt identity persisted on the run for the product Investigation path. */
export const OWNER_READONLY_PROMPT_VERSION = "owner-readonly-v1";

/**
 * Explicit reservation ceilings for normal Investigation start.
 * Matches schema defaults where present; daily/monthly are required by the
 * readonly policy RPC and stay owner-protecting (not operator-funded).
 */
export const OWNER_READONLY_CEILINGS = {
  perRunTokenBudget: 20_000,
  perRunCostUsd: 1,
  perRunLatencyMs: 60_000,
  perRunToolEventBudget: 50,
  dailyTokenBudget: 100_000,
  monthlyTokenBudget: 1_000_000,
  dailyCostUsd: 5,
  monthlyCostUsd: 50,
} as const;

export type OwnerAnalysisReadiness =
  | { ok: true; modelId: OpenAiModelId; modelTier: ModelTier }
  | {
      ok: false;
      reason:
        | "provider_key_missing"
        | "model_not_selected"
        | "model_selection_invalid"
        | "objective_missing"
        | "case_id_invalid";
      message: string;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assessOwnerAnalysisReadiness(input: {
  caseId: string;
  objective: string;
  providerKeyStatus: ProviderKeyStatus | null | undefined;
  modelPreference: string | null | undefined;
}): OwnerAnalysisReadiness {
  if (!UUID_PATTERN.test(input.caseId.trim())) {
    return {
      ok: false,
      reason: "case_id_invalid",
      message: "This Investigation has no usable identity. Analysis cannot start.",
    };
  }
  if (!input.objective.trim()) {
    return {
      ok: false,
      reason: "objective_missing",
      message: "Add an Investigation objective or current question before starting analysis.",
    };
  }
  if (!input.providerKeyStatus || input.providerKeyStatus.configured !== true) {
    return {
      ok: false,
      reason: "provider_key_missing",
      message:
        "Add your OpenAI API key in Settings before starting analysis. The Excavatorium does not use a shared operator key for Custodian work.",
    };
  }
  if (input.modelPreference == null || input.modelPreference === "") {
    return {
      ok: false,
      reason: "model_not_selected",
      message: "Choose a Custodian model in Settings before starting analysis.",
    };
  }
  const modelTier = openAiModelTier(input.modelPreference);
  if (modelTier === null) {
    return {
      ok: false,
      reason: "model_selection_invalid",
      message:
        "The model recorded in Settings is not on the supported list. Choose a supported model before starting analysis.",
    };
  }
  return {
    ok: true,
    modelId: input.modelPreference as OpenAiModelId,
    modelTier,
  };
}

/**
 * Builds the closed readonly start input for a normal Investigation run.
 * Call only after {@link assessOwnerAnalysisReadiness} returns ok.
 */
export function buildOwnerReadonlyAnalysisInput(input: {
  caseId: string;
  objective: string;
  modelTier: ModelTier;
}): ReadonlyAnalysisStartInput {
  return {
    caseId: input.caseId.trim().toLowerCase(),
    policyName: OWNER_READONLY_POLICY_NAME,
    // Allow the full catalog so a later Settings preference change does not
    // collide with an existing owner-readonly policy row. The run still uses
    // exactly the preference-derived tier; the server rejects mismatches.
    allowedModelTiers: [...MODEL_TIERS],
    perRunTokenBudget: OWNER_READONLY_CEILINGS.perRunTokenBudget,
    perRunCostUsd: OWNER_READONLY_CEILINGS.perRunCostUsd,
    perRunLatencyMs: OWNER_READONLY_CEILINGS.perRunLatencyMs,
    perRunToolEventBudget: OWNER_READONLY_CEILINGS.perRunToolEventBudget,
    dailyTokenBudget: OWNER_READONLY_CEILINGS.dailyTokenBudget,
    monthlyTokenBudget: OWNER_READONLY_CEILINGS.monthlyTokenBudget,
    dailyCostUsd: OWNER_READONLY_CEILINGS.dailyCostUsd,
    monthlyCostUsd: OWNER_READONLY_CEILINGS.monthlyCostUsd,
    modelTier: input.modelTier,
    promptVersion: OWNER_READONLY_PROMPT_VERSION,
    objective: input.objective.trim(),
  };
}

/** Prefer objective; fall back to the current question for the analysis brief. */
export function ownerAnalysisObjective(objective: string, currentQuestion: string): string {
  const primary = objective.trim();
  if (primary) return primary;
  return currentQuestion.trim();
}
