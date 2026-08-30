import { authenticatedSupabase, jsonResponse, responseHeaders } from "../_shared/http.ts";
import { authorizeDocumentFetchRequest } from "./authorization.ts";
import {
  fetchTemporaryDocument,
  validateDocumentFetchInput,
  type DocumentFetchInput,
} from "./runtime.ts";

const REQUEST_MAX_BYTES = 64 * 1024;

function safeHeaderValue(value: string | null): string | undefined {
  if (!value || value.length > 240 || hasForbiddenHeaderCharacters(value)) return undefined;
  return value;
}

function hasForbiddenHeaderCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x7f || (code <= 0x1f && code !== 0x09)) return true;
  }
  return false;
}

async function requestBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > REQUEST_MAX_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > REQUEST_MAX_BYTES) return null;
      chunks.push(next.value);
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export async function handleDocumentFetch(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(null) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const auth = await authenticatedSupabase(request);
  if (!auth) return jsonResponse({ error: "Sign in is required." }, 401);
  // authenticatedSupabase has already verified this exact bearer token with
  // Supabase Auth. The helper only decodes its claims after that verification,
  // and binds the token subject to the verified user before reading client_id.
  const access = authorizeDocumentFetchRequest(
    request,
    auth.user.id,
    Deno.env.get("MCP_ALLOWED_CLIENT_IDS"),
  );
  if (access === "configuration_invalid")
    return jsonResponse({ error: "Document fetch authorization is unavailable." }, 500);
  if (access !== "allowed") return jsonResponse({ error: "Client is not permitted." }, 403);

  let input: DocumentFetchInput;
  try {
    input = validateDocumentFetchInput(await requestBody(request));
  } catch {
    return jsonResponse({ error: "Document fetch input is invalid." }, 400);
  }

  try {
    const result = await fetchTemporaryDocument(input);
    const headers: Record<string, string> = {
      ...responseHeaders(null),
      "Cache-Control": "no-store",
      "Content-Type": "application/octet-stream",
      "X-Excavatorium-Document-Content-Type":
        safeHeaderValue(result.contentType?.split(";", 1)[0]?.trim() ?? "") ?? "",
    };
    return new Response(result.bytes, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "fetch_failure";
    if (code === "response_too_large")
      return jsonResponse({ error: "Document is too large." }, 413);
    if (code === "rejected_address" || code === "invalid_url")
      return jsonResponse({ error: "Document URL is not allowed." }, 400);
    if (code === "invalid_request")
      return jsonResponse({ error: "Document fetch input is invalid." }, 400);
    if (code === "timeout") return jsonResponse({ error: "Document fetch timed out." }, 504);
    return jsonResponse({ error: "Document could not be retrieved." }, 502);
  }
}

Deno.serve(handleDocumentFetch);
