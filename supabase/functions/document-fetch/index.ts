import { authenticatedSupabase, jsonResponse, responseHeaders } from "../_shared/http.ts";
import {
  fetchTemporaryDocument,
  validateDocumentFetchInput,
  type DocumentFetchInput,
} from "./runtime.ts";

const INTERNAL_SECRET_HEADER = "x-excavatorium-fetch-secret";
const REQUEST_MAX_BYTES = 64 * 1024;

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1)
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function validInternalSecret(request: Request): boolean {
  const configured = Deno.env.get("DOCUMENT_FETCH_SHARED_SECRET")?.trim();
  const supplied = request.headers.get(INTERNAL_SECRET_HEADER)?.trim();
  return Boolean(configured && supplied && constantTimeEquals(configured, supplied));
}

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
  if (!validInternalSecret(request)) return jsonResponse({ error: "Not found." }, 404);

  const auth = await authenticatedSupabase(request);
  if (!auth) return jsonResponse({ error: "Sign in is required." }, 401);

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
