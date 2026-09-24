/**
 * Central OpenAI model catalog for the Custodian (Edge layer).
 *
 * This is the ONE place the Edge Functions read the selectable model IDs. To
 * add or retire a model, update:
 *   1. this file,
 *   2. src/lib/openai-models.ts (browser mirror; a Bun test asserts parity),
 *   3. public.custodian_openai_model_tier() in a NEW migration (a pgTAP test
 *      asserts parity with this list).
 *
 * `tier` is the existing policy tier (tool_policies.allowed_model_tiers, runs
 * and steps). It is a gating identity, not a promise about capability.
 * `tone` is a coarse UX hint only; no pricing or marketing copy lives here.
 *
 * Selecting a model does not prove the owner's OpenAI project can use it.
 * Provider permission / model-unavailable responses are classified truthfully
 * by the provider path and the run stops; there is no automatic substitution.
 */
export const OPENAI_MODELS = [
  { id: "gpt-5.6-luna", tier: "luna", tone: "efficient" },
  { id: "gpt-5.6-terra", tier: "terra", tone: "balanced" },
  { id: "gpt-5.6-sol", tier: "sol", tone: "strong" },
  { id: "gpt-6-luna", tier: "luna", tone: "efficient" },
  { id: "gpt-6-sol", tier: "sol", tone: "strong" },
  { id: "gpt-6-astra", tier: "pro", tone: "highest" },
] as const;

export type OpenAiModelId = (typeof OPENAI_MODELS)[number]["id"];
export type OpenAiModelTier = (typeof OPENAI_MODELS)[number]["tier"];

export const OPENAI_MODEL_IDS: readonly OpenAiModelId[] = OPENAI_MODELS.map((model) => model.id);

export function isOpenAiModelId(value: unknown): value is OpenAiModelId {
  return typeof value === "string" && OPENAI_MODEL_IDS.some((id) => id === value);
}

export function openAiModelTier(model: string): OpenAiModelTier | null {
  return OPENAI_MODELS.find((entry) => entry.id === model)?.tier ?? null;
}

/** First catalog entry for a tier. Used only where a tier default is needed. */
export function defaultModelForTier(tier: OpenAiModelTier): OpenAiModelId {
  const found = OPENAI_MODELS.find((entry) => entry.tier === tier);
  if (!found) throw new Error("tier has no catalog model");
  return found.id;
}
