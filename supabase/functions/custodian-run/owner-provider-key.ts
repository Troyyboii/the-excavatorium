import {
  decryptProviderKey,
  isPlausibleOpenAiKey,
  loadWrappingKeys,
} from "../_shared/provider-key-crypto.ts";
import type { OwnerProviderKey } from "./provider-attempt.ts";

export type StoredCredential = { ciphertext: string; keyVersion: number };

/**
 * Resolves the calling owner's OpenAI key inside the trusted runtime.
 *
 * `fetchCredential` must read the ciphertext for exactly `ownerId` (the
 * service-role RPC keyed by the JWT-derived owner). The ciphertext is bound to
 * that owner by AES-GCM associated data, so even a mis-keyed row for another
 * owner fails authentication here and yields "unreadable", never a key.
 *
 * Every failure collapses to a fixed status. No error text, ciphertext, or
 * key material is returned or logged.
 */
export async function resolveOwnerProviderKey(input: {
  ownerId: string;
  fetchCredential: (ownerId: string) => Promise<StoredCredential | null>;
  getEnv: (name: string) => string | undefined;
}): Promise<OwnerProviderKey> {
  let stored: StoredCredential | null;
  try {
    stored = await input.fetchCredential(input.ownerId);
  } catch {
    return { status: "unreadable" };
  }
  if (!stored) return { status: "missing" };
  try {
    const wrapping = loadWrappingKeys(input.getEnv);
    const apiKey = await decryptProviderKey(
      wrapping,
      input.ownerId,
      stored.ciphertext,
      stored.keyVersion,
    );
    if (!isPlausibleOpenAiKey(apiKey)) return { status: "unreadable" };
    return { status: "ok", apiKey };
  } catch {
    return { status: "unreadable" };
  }
}

export function parseStoredCredential(value: unknown): StoredCredential | null | "malformed" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "malformed";
  const record = value as Record<string, unknown>;
  if (typeof record.ciphertext !== "string" || record.ciphertext.length === 0) return "malformed";
  if (
    typeof record.key_version !== "number" ||
    !Number.isInteger(record.key_version) ||
    record.key_version < 1
  ) {
    return "malformed";
  }
  return { ciphertext: record.ciphertext, keyVersion: record.key_version };
}
