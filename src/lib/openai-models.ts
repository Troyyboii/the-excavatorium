/**
 * Central OpenAI model catalog for Custodian model choice (browser mirror).
 *
 * Mirrors supabase/functions/_shared/openai-models.ts and the SQL function
 * public.custodian_openai_model_tier(); src/lib/openai-models.test.ts fails if
 * any of the three drift. To add or retire a model, change all three.
 *
 * `tier` is the existing policy tier (see custodian-runtime-types.ts). `tone`
 * is a coarse, non-marketing hint. Choosing a model does not prove the owner's
 * OpenAI project can use it; the provider decides at run time and an
 * unavailable model stops the run. Nothing is silently substituted.
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
export type OpenAiModelTone = (typeof OPENAI_MODELS)[number]["tone"];

export const OPENAI_MODEL_IDS: readonly OpenAiModelId[] = OPENAI_MODELS.map((model) => model.id);

export function isOpenAiModelId(value: unknown): value is OpenAiModelId {
  return typeof value === "string" && OPENAI_MODEL_IDS.some((id) => id === value);
}

export function openAiModelTier(model: string): OpenAiModelTier | null {
  return OPENAI_MODELS.find((entry) => entry.id === model)?.tier ?? null;
}

export function defaultModelForTier(tier: OpenAiModelTier): OpenAiModelId {
  const found = OPENAI_MODELS.find((entry) => entry.tier === tier);
  if (!found) throw new Error("tier has no catalog model");
  return found.id;
}

export const MODEL_TONE_LABEL: Record<OpenAiModelTone, string> = {
  efficient: "Efficient",
  balanced: "Balanced",
  strong: "Strong",
  highest: "Highest capability",
};
