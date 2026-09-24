import { createClient } from "npm:@supabase/supabase-js@2";
import {
  allowedOrigin,
  authenticatedSupabase,
  jsonResponse,
  responseHeaders,
  trustedRuntimeSupabase,
  type AuthenticatedSupabase,
} from "../_shared/http.ts";

/**
 * Owner self-delete. Authenticated ownership only. Order:
 *   1. Require deliberate confirmation phrase + password re-auth
 *   2. Purge document-files/<uid>/ Storage objects (does not cascade from auth.users)
 *   3. purge_owner_account_data(runtime_owner_id) via service_role (RESTRICT-safe table order)
 *   4. auth.admin.deleteUser via trusted service-role boundary
 *
 * Storage must succeed before any DB wipe so a Storage failure cannot leave a
 * login whose structured rows/credentials are already gone. Abort on Storage
 * failure before calling the purge RPC.
 *
 * Never exports or logs API keys, ciphertext, or wrapping keys. No provider calls.
 */

export const MAX_REQUEST_BYTES = 1024;
export const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";
export const STORAGE_BUCKET = "document-files";
export const MAX_PASSWORD_CHARS = 256;

export type AccountDeleteDependencies = {
  authenticate: (request: Request) => Promise<AuthenticatedSupabase | null>;
  trustedClient: () => AuthenticatedSupabase["client"] | null;
  verifyPassword: (email: string, password: string, expectedOwnerId: string) => Promise<boolean>;
};

async function defaultVerifyPassword(
  email: string,
  password: string,
  expectedOwnerId: string,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return false;
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  const matched = !error && data.user?.id === expectedOwnerId;
  // Drop the ephemeral GoTrue session created by step-up verification.
  try {
    await client.auth.signOut();
  } catch {
    // Verification outcome must not depend on cleanup succeeding.
  }
  return matched;
}

const defaultDependencies: AccountDeleteDependencies = {
  authenticate: authenticatedSupabase,
  trustedClient: trustedRuntimeSupabase,
  verifyPassword: defaultVerifyPassword,
};

type JsonRecord = Record<string, unknown>;

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

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path?: string,
        options?: { limit?: number; offset?: number },
      ) => Promise<{ data: Array<{ name: string; id: string | null }> | null; error: unknown }>;
      remove: (paths: string[]) => Promise<{ error: unknown }>;
    };
  };
};

/** Recursively lists then removes every object under document-files/<ownerId>/. */
export async function purgeOwnerDocumentFiles(
  client: StorageClient,
  ownerId: string,
): Promise<number> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error("owner id is invalid");
  }
  const bucket = client.storage.from(STORAGE_BUCKET);
  let removed = 0;

  async function walk(prefix: string): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset });
      if (error) throw new Error("Storage listing failed.");
      const entries = data ?? [];
      if (entries.length === 0) break;

      const files: string[] = [];
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Folders often have id === null in Supabase Storage listings.
        if (entry.id === null) {
          await walk(path);
        } else {
          files.push(path);
        }
      }
      if (files.length > 0) {
        const { error: removeError } = await bucket.remove(files);
        if (removeError) throw new Error("Storage purge failed.");
        removed += files.length;
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
  }

  await walk(ownerId);
  return removed;
}

export function createAccountDeleteHandler(
  dependencies: AccountDeleteDependencies = defaultDependencies,
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

    const keys = Object.keys(payload).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== "confirmation" ||
      keys[1] !== "password" ||
      payload.confirmation !== CONFIRMATION_PHRASE
    ) {
      return jsonResponse(
        {
          error: `Type ${CONFIRMATION_PHRASE} exactly and re-enter your password to permanently delete this account.`,
        },
        400,
        origin,
      );
    }

    const password = payload.password;
    if (
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_CHARS
    ) {
      return jsonResponse({ error: "Password re-authentication is required." }, 400, origin);
    }

    const email = auth.user.email;
    if (!email || typeof email !== "string") {
      return jsonResponse(
        { error: "Password re-authentication requires an email login on this account." },
        400,
        origin,
      );
    }

    let passwordOk = false;
    try {
      passwordOk = await dependencies.verifyPassword(email, password, auth.user.id);
    } catch {
      return jsonResponse(
        { error: "Password re-authentication is temporarily unavailable." },
        503,
        origin,
      );
    }
    if (!passwordOk) {
      return jsonResponse({ error: "Password is incorrect." }, 401, origin);
    }

    const ownerId = auth.user.id;
    const trusted = dependencies.trustedClient();
    if (!trusted) {
      return jsonResponse({ error: "Account deletion is temporarily unavailable." }, 503, origin);
    }

    // Storage first so a Storage failure aborts before wiping structured rows.
    let storageRemoved = 0;
    try {
      storageRemoved = await purgeOwnerDocumentFiles(
        auth.client as unknown as StorageClient,
        ownerId,
      );
    } catch {
      try {
        storageRemoved = await purgeOwnerDocumentFiles(
          trusted as unknown as StorageClient,
          ownerId,
        );
      } catch {
        return jsonResponse({ error: "Document Storage could not be purged." }, 503, origin);
      }
    }

    // service_role only; table order breaks ON DELETE RESTRICT graphs (D1).
    const { data: purgeData, error: purgeError } = await trusted.rpc("purge_owner_account_data", {
      runtime_owner_id: ownerId,
    });
    if (purgeError) {
      return jsonResponse({ error: "Account data could not be purged." }, 503, origin);
    }

    const { error: deleteError } = await trusted.auth.admin.deleteUser(ownerId);
    if (deleteError) {
      return jsonResponse({ error: "Auth identity could not be deleted." }, 503, origin);
    }

    return jsonResponse(
      {
        deleted: true,
        storageObjectsRemoved: storageRemoved,
        purge: purgeData ?? { purged: true },
      },
      200,
      origin,
    );
  };
}

if (typeof Deno !== "undefined" && import.meta.main) Deno.serve(createAccountDeleteHandler());
