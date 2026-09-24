/**
 * Server-side envelope for owner-supplied provider API keys.
 *
 * AES-256-GCM with a fresh 96-bit random nonce per encryption. The
 * additional-authenticated-data binds each ciphertext to its owner, provider
 * and key version, so a ciphertext copied to another owner's row (or replayed
 * under another version) fails authentication and is never decrypted.
 *
 * Wrapping keys are Edge secrets, never database values:
 *   PROVIDER_KEY_ENCRYPTION_KEYS  JSON object {"1":"<base64 32 bytes>", ...}
 *   PROVIDER_KEY_ACTIVE_VERSION   integer version used for new encryptions
 * Old versions stay in the map so existing ciphertexts remain readable while
 * new saves use the active version (rotation = add a version, switch active,
 * owners re-save or a later job re-wraps).
 *
 * Plaintext exists only transiently in memory. Errors from this module carry
 * fixed codes only and never include the key, the ciphertext, or key bytes.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PROVIDER_KEY_ENCRYPTION_KEYS_ENV = "PROVIDER_KEY_ENCRYPTION_KEYS";
export const PROVIDER_KEY_ACTIVE_VERSION_ENV = "PROVIDER_KEY_ACTIVE_VERSION";
export const PROVIDER_KEY_PROVIDER = "openai";

/** OpenAI secret keys are `sk-` plus URL-safe characters (incl. `sk-proj-...`). */
const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,300}$/;
const MAX_CIPHERTEXT_CHARS = 2048;

export type ProviderKeyCryptoErrorCode =
  | "crypto_not_configured"
  | "invalid_key_format"
  | "unknown_key_version"
  | "decrypt_failed";

export class ProviderKeyCryptoError extends Error {
  constructor(readonly code: ProviderKeyCryptoErrorCode) {
    super(code);
    this.name = "ProviderKeyCryptoError";
  }
}

export type WrappingKeys = {
  activeVersion: number;
  keys: ReadonlyMap<number, Uint8Array<ArrayBuffer>>;
};

export function isPlausibleOpenAiKey(value: unknown): value is string {
  return typeof value === "string" && OPENAI_KEY_PATTERN.test(value);
}

/** The only key-derived value that may leave the trusted boundary. */
export function keyLastFour(apiKey: string): string {
  return apiKey.slice(-4);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function loadWrappingKeys(env: (name: string) => string | undefined): WrappingKeys {
  const rawKeys = env(PROVIDER_KEY_ENCRYPTION_KEYS_ENV);
  const rawActive = env(PROVIDER_KEY_ACTIVE_VERSION_ENV);
  if (!rawKeys || !rawActive) throw new ProviderKeyCryptoError("crypto_not_configured");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new ProviderKeyCryptoError("crypto_not_configured");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderKeyCryptoError("crypto_not_configured");
  }
  const keys = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const [versionText, encoded] of Object.entries(parsed)) {
    const version = Number(versionText);
    if (
      !Number.isInteger(version) ||
      version < 1 ||
      version > 1000 ||
      typeof encoded !== "string"
    ) {
      throw new ProviderKeyCryptoError("crypto_not_configured");
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(encoded);
    } catch {
      throw new ProviderKeyCryptoError("crypto_not_configured");
    }
    if (bytes.length !== 32) throw new ProviderKeyCryptoError("crypto_not_configured");
    keys.set(version, bytes);
  }
  const activeVersion = Number(rawActive);
  if (!Number.isInteger(activeVersion) || !keys.has(activeVersion)) {
    throw new ProviderKeyCryptoError("crypto_not_configured");
  }
  return { activeVersion, keys };
}

async function importKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function associatedData(ownerId: string, version: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `excavatorium:provider-key:${PROVIDER_KEY_PROVIDER}:${ownerId}:v${version}`,
  );
}

export async function encryptProviderKey(
  wrapping: WrappingKeys,
  ownerId: string,
  apiKey: string,
): Promise<{ ciphertext: string; keyVersion: number; last4: string }> {
  if (!isPlausibleOpenAiKey(apiKey)) throw new ProviderKeyCryptoError("invalid_key_format");
  const version = wrapping.activeVersion;
  const keyBytes = wrapping.keys.get(version);
  if (!keyBytes) throw new ProviderKeyCryptoError("unknown_key_version");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: associatedData(ownerId, version) },
      await importKey(keyBytes),
      encoder.encode(apiKey),
    ),
  );
  const packed = new Uint8Array(nonce.length + sealed.length);
  packed.set(nonce, 0);
  packed.set(sealed, nonce.length);
  const ciphertext = bytesToBase64(packed);
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    throw new ProviderKeyCryptoError("invalid_key_format");
  }
  return { ciphertext, keyVersion: version, last4: keyLastFour(apiKey) };
}

export async function decryptProviderKey(
  wrapping: WrappingKeys,
  ownerId: string,
  ciphertext: string,
  keyVersion: number,
): Promise<string> {
  const keyBytes = wrapping.keys.get(keyVersion);
  if (!keyBytes) throw new ProviderKeyCryptoError("unknown_key_version");
  try {
    const packed = base64ToBytes(ciphertext);
    if (packed.length <= 12 + 16) throw new Error("short");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: packed.slice(0, 12),
        additionalData: associatedData(ownerId, keyVersion),
      },
      await importKey(keyBytes),
      packed.slice(12),
    );
    return decoder.decode(plaintext);
  } catch {
    // Wrong owner, wrong version, tampering and malformed input all land here
    // with the same fixed code; nothing from the failure is echoed.
    throw new ProviderKeyCryptoError("decrypt_failed");
  }
}
