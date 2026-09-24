import { isOpenAiModelId } from "./openai-models.ts";
import {
  parseStoredCredential,
  resolveOwnerProviderKey,
  type OwnerProviderKey,
  type StoredCredential,
} from "./owner-provider-key.ts";

export type ExcavationFundingFailure =
  | "provider_key_missing"
  | "provider_key_unreadable"
  | "model_not_selected"
  | "model_selection_invalid";

export type ExcavationFunding =
  | { ok: true; apiKey: string; model: string }
  | { ok: false; reason: ExcavationFundingFailure };

/**
 * Combines the owner's decrypted key and Settings model preference into a
 * funding decision for Conversation / File Excavation. There is no operator
 * OPENAI_API_KEY fallback: missing key or model fails closed before any
 * provider contact. Secrets are never returned in failure cases.
 */
export function excavationFundingFromParts(
  key: OwnerProviderKey,
  preferredModel: string | null | undefined,
): ExcavationFunding {
  if (key.status === "missing") return { ok: false, reason: "provider_key_missing" };
  if (key.status === "unreadable") return { ok: false, reason: "provider_key_unreadable" };
  if (preferredModel === null || preferredModel === undefined || preferredModel === "") {
    return { ok: false, reason: "model_not_selected" };
  }
  if (!isOpenAiModelId(preferredModel)) return { ok: false, reason: "model_selection_invalid" };
  return { ok: true, apiKey: key.apiKey, model: preferredModel };
}

export function excavationFundingMessage(reason: ExcavationFundingFailure): string {
  switch (reason) {
    case "provider_key_missing":
      return "Add your OpenAI API key in Settings before excavating.";
    case "provider_key_unreadable":
      return "Your OpenAI API key could not be read. Update it in Settings.";
    case "model_not_selected":
      return "Choose a model in Settings before excavating.";
    case "model_selection_invalid":
      return "The selected model is not on the supported list. Choose a model in Settings.";
  }
}

export async function resolveOwnerExcavationFunding(input: {
  ownerId: string;
  preferredModel: string | null | undefined;
  fetchCredential: (ownerId: string) => Promise<StoredCredential | null>;
  getEnv: (name: string) => string | undefined;
}): Promise<ExcavationFunding> {
  const key = await resolveOwnerProviderKey({
    ownerId: input.ownerId,
    fetchCredential: input.fetchCredential,
    getEnv: input.getEnv,
  });
  return excavationFundingFromParts(key, input.preferredModel);
}

export { parseStoredCredential, resolveOwnerProviderKey };
export type { OwnerProviderKey, StoredCredential };
