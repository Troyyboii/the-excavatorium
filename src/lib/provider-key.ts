// Client for owner-supplied OpenAI key management and model choice (BYOK for
// Custodian provider execution).
//
// Secret handling contract:
//   * The API key is sent once, over TLS, to the authenticated `provider-key`
//     Edge Function, which encrypts it server-side. It is never written to
//     localStorage/sessionStorage/IndexedDB, never placed in a query cache or
//     mutation state, never logged, and never sent anywhere else.
//   * Nothing here can read a key back. The only key-derived value the browser
//     ever receives is the last four characters and a key version.
//   * Saving a key does NOT contact OpenAI. There is no automatic validation.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useCurrentUserId } from "./session";
import { isOpenAiModelId, type OpenAiModelId } from "./openai-models";

export type ProviderKeyStatus =
  | { configured: false }
  | { configured: true; last4: string; keyVersion: number; updatedAt: string | null };

export function parseProviderKeyStatus(value: unknown): ProviderKeyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Key status was not readable.");
  }
  const row = value as Record<string, unknown>;
  if (row.configured !== true) return { configured: false };
  const last4 = typeof row.last4 === "string" && /^[A-Za-z0-9_-]{1,4}$/.test(row.last4);
  if (!last4) throw new Error("Key status was not readable.");
  return {
    configured: true,
    last4: row.last4 as string,
    keyVersion: typeof row.key_version === "number" ? row.key_version : 0,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

// Query keys sit under "custodian" so AuthGate evicts them on any account change.
const statusKey = (userId: string | null) => ["custodian", "provider-key", userId ?? "__anon__"];
const modelKey = (userId: string | null) => ["custodian", "model-preference", userId ?? "__anon__"];

export type FunctionsClient = {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
};

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await (error.context as Response).clone().json();
      if (
        body &&
        typeof body === "object" &&
        typeof (body as { error?: unknown }).error === "string"
      ) {
        return (body as { error: string }).error;
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return fallback;
}

/** Sends the key to the server for encryption. The caller must clear its own copy afterward. */
export async function saveProviderKey(
  apiKey: string,
  client: FunctionsClient = supabase,
): Promise<ProviderKeyStatus> {
  const { data, error } = await client.functions.invoke("provider-key", {
    body: { action: "set", apiKey },
  });
  if (error) throw new Error(await functionErrorMessage(error, "The key could not be saved."));
  const row = (data ?? {}) as Record<string, unknown>;
  return parseProviderKeyStatus({ ...row, key_version: row.keyVersion });
}

export async function removeProviderKey(client: FunctionsClient = supabase): Promise<void> {
  const { error } = await client.functions.invoke("provider-key", { body: { action: "remove" } });
  if (error) throw new Error(await functionErrorMessage(error, "The key could not be removed."));
}

export function useProviderKeyStatus() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: statusKey(userId),
    enabled: userId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custodian_provider_key_status");
      if (error) throw new Error(error.message);
      return parseProviderKeyStatus(data);
    },
  });
}

export function useModelPreference() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: modelKey(userId),
    enabled: userId !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<OpenAiModelId | null> => {
      const { data, error } = await supabase
        .from("owner_provider_settings")
        .select("model_name")
        .eq("provider", "openai")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const name = (data as { model_name?: unknown } | null)?.model_name;
      return isOpenAiModelId(name) ? name : null;
    },
  });
}

export async function setModelPreference(model: OpenAiModelId): Promise<void> {
  if (!isOpenAiModelId(model)) throw new Error("That model is not on the supported list.");
  const { error } = await supabase.rpc("custodian_set_model_preference", { model_name: model });
  if (error) throw new Error(error.message);
}

export function useInvalidateProviderSettings() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return () => {
    void qc.invalidateQueries({ queryKey: statusKey(userId) });
    void qc.invalidateQueries({ queryKey: modelKey(userId) });
  };
}
