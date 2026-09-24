/**
 * Normal-owner Investigation analysis start.
 *
 * Builds an explicit readonly analysis input without asking the owner to type
 * case_id, policy_name, model_tier, prompt_version, pricing, or reservation
 * ceilings. Technical Advanced / Run Room still accepts those fields.
 *
 * Ceilings remain real owner-visible budgets (not removed). Preference-derived
 * tier still must match the server BYOK preference or the run fails closed.
 *
 * Policy identity is deliberately distinct from Advanced's common
 * `owner-readonly` draft name so stale Advanced ceilings/tiers cannot
 * 23505-collide with Investigation Start Analysis.
 */
import { MODEL_ALLOWLIST, type ModelTier } from "./custodian-runtime-types";
import type { ReadonlyAnalysisStartInput } from "./custodian-readonly-run";
import type { OpenAiModelId } from "./openai-models";
import { openAiModelTier } from "./openai-models";
import type { ProviderKeyStatus } from "./provider-key";

const MODEL_TIERS = Object.keys(MODEL_ALLOWLIST) as ModelTier[];

/**
 * Dedicated policy identity for Investigation Start Analysis.
 * Must not equal the Advanced/Run Room draft name owners commonly type
 * (`owner-readonly`), or ensure-policy fails closed on parameter mismatch.
 */
export const INVESTIGATION_READONLY_POLICY_NAME = "investigation-readonly";

/** @deprecated Alias kept for local imports that still name the constant OWNER_*. */
export const OWNER_READONLY_POLICY_NAME = INVESTIGATION_READONLY_POLICY_NAME;

/** Prompt identity persisted on the run for the product Investigation path. */
export const INVESTIGATION_READONLY_PROMPT_VERSION = "investigation-readonly-v1";

/** @deprecated Prefer INVESTIGATION_READONLY_PROMPT_VERSION. */
export const OWNER_READONLY_PROMPT_VERSION = INVESTIGATION_READONLY_PROMPT_VERSION;

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
        | "provider_settings_unavailable"
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
  /** True when Settings key/model queries failed (distinct from “not configured”). */
  settingsUnavailable?: boolean;
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
  if (input.settingsUnavailable) {
    return {
      ok: false,
      reason: "provider_settings_unavailable",
      message:
        "Settings could not be read, so key and model status are unknown. Refresh or open Settings, then try again. Analysis was not started.",
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
 *
 * Always uses {@link INVESTIGATION_READONLY_POLICY_NAME} and fixed product
 * ceilings so Advanced drafts named `owner-readonly` with different params
 * cannot collide.
 */
export function buildOwnerReadonlyAnalysisInput(input: {
  caseId: string;
  objective: string;
  modelTier: ModelTier;
}): ReadonlyAnalysisStartInput {
  return {
    caseId: input.caseId.trim().toLowerCase(),
    policyName: INVESTIGATION_READONLY_POLICY_NAME,
    // Full catalog on this Investigation-only policy so a later Settings
    // preference change does not 23505 against the same investigation-readonly
    // row. The run still uses exactly the preference-derived tier; the server
    // rejects mismatches. Advanced `owner-readonly` drafts are a different name.
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
    promptVersion: INVESTIGATION_READONLY_PROMPT_VERSION,
    objective: input.objective.trim(),
  };
}

/** Prefer objective; fall back to the current question for the analysis brief. */
export function ownerAnalysisObjective(objective: string, currentQuestion: string): string {
  const primary = objective.trim();
  if (primary) return primary;
  return currentQuestion.trim();
}
