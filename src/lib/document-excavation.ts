import { supabase } from "./supabase";
import {
  documentDraftSchema,
  fingerprintFile,
  validateSelectedDocumentFile,
  type DocumentDraft,
} from "./document";
import type { ArchiveRecord } from "./types";

export type DocumentCandidateRecord = Pick<ArchiveRecord, "id" | "title" | "recordType">;

const GENERIC_RELAY_MESSAGE =
  "File excavation could not be reached. Check your connection and retry.";
const GENERIC_FAILURE_MESSAGE = "File excavation could not be completed. Please retry.";
const GENERIC_TIMEOUT_MESSAGE = "File excavation timed out before completion. Please retry.";

type SafeFunctionDiagnostic =
  | "authentication_unavailable"
  | "configuration_unavailable"
  | "quota_rpc_failure"
  | "quota_exceeded"
  | "extraction_timeout"
  | "upstream_authentication"
  | "upstream_rate_limit"
  | "upstream_quota"
  | "upstream_service_failure"
  | "upstream_failure"
  | "invalid_output"
  | "schema_validation_failure"
  | "content_hash_failure"
  | "source_reference_validation_failure"
  | "unknown_extraction_failure";

const SAFE_FUNCTION_DIAGNOSTICS: ReadonlySet<string> = new Set([
  "authentication_unavailable",
  "configuration_unavailable",
  "quota_rpc_failure",
  "quota_exceeded",
  "extraction_timeout",
  "upstream_authentication",
  "upstream_rate_limit",
  "upstream_quota",
  "upstream_service_failure",
  "upstream_failure",
  "invalid_output",
  "schema_validation_failure",
  "content_hash_failure",
  "source_reference_validation_failure",
  "unknown_extraction_failure",
]);

function browserMessageForDiagnostic(diagnostic: SafeFunctionDiagnostic): string {
  if (diagnostic === "quota_exceeded")
    return "File excavation is temporarily rate limited. Please retry later.";
  if (diagnostic === "extraction_timeout") return GENERIC_TIMEOUT_MESSAGE;
  if (
    diagnostic === "authentication_unavailable" ||
    diagnostic === "configuration_unavailable" ||
    diagnostic === "quota_rpc_failure"
  )
    return "File excavation is temporarily unavailable. Please retry later.";
  if (
    diagnostic === "invalid_output" ||
    diagnostic === "schema_validation_failure" ||
    diagnostic === "content_hash_failure" ||
    diagnostic === "source_reference_validation_failure"
  )
    return "File excavation returned an incomplete result. Please retry.";
  return GENERIC_FAILURE_MESSAGE;
}

export async function sanitizedFunctionErrorDiagnostic(
  error: unknown,
): Promise<SafeFunctionDiagnostic | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const response = context as Partial<Response> & { json?: unknown; clone?: unknown };
  if (typeof response.json !== "function" || typeof response.clone !== "function") return null;
  try {
    const body = await (response.clone() as Response).json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const diagnostic = (body as { diagnostic?: unknown }).diagnostic;
    return typeof diagnostic === "string" && SAFE_FUNCTION_DIAGNOSTICS.has(diagnostic)
      ? (diagnostic as SafeFunctionDiagnostic)
      : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the Edge Function's sanitized `{ error }` message from a Supabase
 * FunctionsHttpError. The response body is read from the error context only;
 * only the server's allowlisted diagnostic and sanitized message are surfaced,
 * so secrets, prompts, upstream payloads, and document text can never reach the UI.
 */
export async function sanitizedFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const response = context as Partial<Response> & { json?: unknown };
  const fallback = response.status === 504 ? GENERIC_TIMEOUT_MESSAGE : null;
  if (typeof response.json !== "function" || typeof response.clone !== "function") return fallback;
  let body: unknown;
  try {
    body = await (response.clone() as Response).json();
  } catch {
    return fallback;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const message = (body as { error?: unknown }).error;
  if (typeof message !== "string") return fallback;
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return fallback;
  return trimmed;
}

export async function excavateDocument(
  file: File,
  records: DocumentCandidateRecord[],
  signal?: AbortSignal,
): Promise<DocumentDraft> {
  const fileError = validateSelectedDocumentFile(file);
  if (fileError) throw new Error(fileError);
  const fingerprint = await fingerprintFile(file);
  if (signal?.aborted) throw new DOMException("Excavation cancelled.", "AbortError");

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("contentHash", fingerprint);
  body.append(
    "candidateRecords",
    JSON.stringify(
      records.slice(0, 75).map(({ id, title, recordType }) => ({ id, title, recordType })),
    ),
  );

  const { data, error } = await supabase.functions.invoke("document-extract", {
    body,
    signal,
  });
  if (error) {
    if (signal?.aborted) throw new DOMException("Excavation cancelled.", "AbortError");
    const diagnostic = await sanitizedFunctionErrorDiagnostic(error);
    if (diagnostic) throw new Error(browserMessageForDiagnostic(diagnostic));
    const message = await sanitizedFunctionErrorMessage(error);
    // A parsed body means the function responded: surface its sanitized text.
    // Otherwise the failure was network or relay level and stays generic.
    throw new Error(message ?? GENERIC_RELAY_MESSAGE);
  }
  const parsed = documentDraftSchema.safeParse(data);
  if (!parsed.success) throw new Error("File excavation returned an incomplete draft.");
  if (parsed.data.contentHash !== fingerprint) {
    throw new Error("The selected file changed while it was being excavated.");
  }
  return parsed.data;
}

export { GENERIC_FAILURE_MESSAGE, GENERIC_RELAY_MESSAGE, GENERIC_TIMEOUT_MESSAGE };
