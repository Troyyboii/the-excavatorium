import {
  allowedOrigin,
  authenticatedSupabase,
  jsonResponse,
  logDiagnostic,
  responseHeaders,
  trustedRuntimeSupabase,
  type AuthenticatedSupabase,
} from "../_shared/http.ts";
import {
  encryptProviderKey,
  isPlausibleOpenAiKey,
  loadWrappingKeys,
  ProviderKeyCryptoError,
  type WrappingKeys,
} from "../_shared/provider-key-crypto.ts";

/**
 * Owner-scoped OpenAI API key management for the Custodian (BYOK).
 *
 * POST {"action":"set","apiKey":"sk-..."}  encrypt server-side, store ciphertext
 * POST {"action":"remove"}                  delete the owner's credential
 *
 * The key crosses the network exactly once, over TLS, to this authenticated
 * boundary. It is encrypted here with a server-only wrapping key, and only
 * ciphertext plus non-secret metadata (last four characters, key version)
 * reaches Postgres. The response never contains the key or the ciphertext.
 * Nothing in this file logs the request body, the key, or upstream errors.
 * No provider call is made: saving a key does not contact OpenAI.
 */

export const MAX_REQUEST_BYTES = 2_048;

type JsonRecord = Record<string, unknown>;

export type ProviderKeyDependencies = {
  authenticate: (request: Request) => Promise<AuthenticatedSupabase | null>;
  trustedClient: () => AuthenticatedSupabase["client"] | null;
  getEnv: (name: string) => string | undefined;
};

const defaultDependencies: ProviderKeyDependencies = {
  authenticate: authenticatedSupabase,
  trustedClient: trustedRuntimeSupabase,
  getEnv: (name) => Deno.env.get(name),
};

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readBody(
  request: Request,
): Promise<{ value: JsonRecord | null; tooLarge: boolean }> {
  if (!request.body) return { value: null, tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { value: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return { value: isObject(parsed) ? parsed : null, tooLarge: false };
  } catch {
    return { value: null, tooLarge: false };
  }
}

export function createProviderKeyHandler(
  dependencies: ProviderKeyDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async function handleRequest(request: Request): Promise<Response> {
    const requestOrigin = request.headers.get("Origin");
    const origin = allowedOrigin(requestOrigin);
    if (requestOrigin && !origin) return jsonResponse({ error: "Origin is not allowed." }, 403);
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: responseHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
    ) {
      return jsonResponse({ error: "Request is too large." }, 413, origin);
    }

    let auth: AuthenticatedSupabase | null;
    try {
      auth = await dependencies.authenticate(request);
    } catch {
      return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503, origin);
    }
    if (!auth) return jsonResponse({ error: "Sign in is required." }, 401, origin);

    let body: { value: JsonRecord | null; tooLarge: boolean };
    try {
      body = await readBody(request);
    } catch {
      return jsonResponse({ error: "Request must be valid JSON." }, 400, origin);
    }
    if (body.tooLarge) return jsonResponse({ error: "Request is too large." }, 413, origin);
    const payload = body.value;
    if (!payload) return jsonResponse({ error: "Request must be valid JSON." }, 400, origin);

    if (payload.action === "remove") {
      if (Object.keys(payload).length !== 1) {
        return jsonResponse({ error: "Unsupported request." }, 400, origin);
      }
      // Runs as the caller: the RPC derives the owner from auth.uid().
      const { error } = await auth.client.rpc("custodian_remove_provider_credential");
      if (error) return jsonResponse({ error: "The key could not be removed." }, 503, origin);
      return jsonResponse({ configured: false }, 200, origin);
    }

    if (payload.action !== "set") {
      return jsonResponse({ error: "Unsupported request." }, 400, origin);
    }
    if (Object.keys(payload).length !== 2 || typeof payload.apiKey !== "string") {
      return jsonResponse({ error: "Unsupported request." }, 400, origin);
    }
    const apiKey = payload.apiKey.trim();
    if (!isPlausibleOpenAiKey(apiKey)) {
      return jsonResponse({ error: "That does not look like an OpenAI API key." }, 400, origin);
    }

    let wrapping: WrappingKeys;
    try {
      wrapping = loadWrappingKeys(dependencies.getEnv);
    } catch {
      logDiagnostic("provider-key", "encryption_key_config_invalid", { status: 503 });
      return jsonResponse(
        { error: "Key storage is not configured on this server.", code: "encryption_config" },
        503,
        origin,
      );
    }
    const trusted = dependencies.trustedClient();
    if (!trusted) {
      logDiagnostic("provider-key", "trusted_client_unavailable", { status: 503 });
      return jsonResponse(
        { error: "Key storage is not configured on this server.", code: "trusted_client" },
        503,
        origin,
      );
    }

    try {
      const sealed = await encryptProviderKey(wrapping, auth.user.id, apiKey);
      const { error } = await trusted.rpc("custodian_store_provider_credential", {
        runtime_owner_id: auth.user.id,
        ciphertext: sealed.ciphertext,
        key_version: sealed.keyVersion,
        key_last4: sealed.last4,
      });
      if (error) {
        logDiagnostic("provider-key", "store_rpc_failed", { status: 503 });
        return jsonResponse(
          { error: "The key could not be saved.", code: "store_failed" },
          503,
          origin,
        );
      }
      return jsonResponse(
        { configured: true, last4: sealed.last4, keyVersion: sealed.keyVersion },
        200,
        origin,
      );
    } catch (error) {
      if (error instanceof ProviderKeyCryptoError && error.code === "invalid_key_format") {
        return jsonResponse({ error: "That does not look like an OpenAI API key." }, 400, origin);
      }
      logDiagnostic("provider-key", "encrypt_or_store_failed", { status: 503 });
      return jsonResponse(
        { error: "The key could not be saved.", code: "store_failed" },
        503,
        origin,
      );
    }
  };
}

if (typeof Deno !== "undefined" && import.meta.main) Deno.serve(createProviderKeyHandler());
